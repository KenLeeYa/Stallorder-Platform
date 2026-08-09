import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const control = new PrismaClient();
const organizationId = "f1000000-0000-4000-8000-000000000001";
const stallId = "f1000000-0000-4000-8000-000000000002";

type CapacitySnapshotRow = {
  snapshot: Prisma.JsonValue;
};

type BackendPidRow = {
  pid: number;
};

test.describe.serial("QR 容量刷新併發鎖定", () => {
  test.beforeAll(async () => {
    await removeFixture();
    await control.$transaction(async (transaction) => {
      await transaction.organization.create({
        data: {
          id: organizationId,
          name: "E2E 容量併發測試商家",
          slug: "e2e-capacity-refresh-concurrency",
          businessName: "E2E 容量併發測試商家",
          status: "ACTIVE",
          email: "capacity-refresh-concurrency@stallorder.test",
          phone: "0900000000",
        },
      });
      const planVersion = await transaction.planVersion.findFirstOrThrow({
        where: { plan: { code: "TRIAL" }, effectiveUntil: null },
        select: { id: true, planId: true },
      });
      const billingPeriodStart = new Date();
      billingPeriodStart.setUTCHours(0, 0, 0, 0);
      const billingPeriodEnd = new Date(billingPeriodStart);
      billingPeriodEnd.setUTCDate(billingPeriodEnd.getUTCDate() + 30);
      await transaction.subscription.create({
        data: {
          organizationId,
          planId: planVersion.planId,
          planVersionId: planVersion.id,
          status: "ACTIVE",
          billingInterval: "MONTHLY",
          billingPeriodStart,
          billingPeriodEnd,
        },
      });
      await transaction.stall.create({
        data: {
          id: stallId,
          organizationId,
          name: "E2E 容量併發測試攤位",
          slug: "e2e-capacity-refresh-concurrency-stall",
          code: "CAPACITY-CONCURRENCY",
          address: "E2E local database only",
          location: "E2E local database only",
        },
      });
      await transaction.stallCapacitySettings.update({
        where: { stallId },
        data: {
          manualWaitMinutes: 11,
          autoPauseEnabled: true,
          autoResumeEnabled: true,
        },
      });
    });
  });

  test.afterAll(async () => {
    try {
      await removeFixture();
    } finally {
      await control.$disconnect();
    }
  });

  test("同攤位 refresh 依固定鎖順序串行、無 deadlock，並回傳權威 snapshot", async () => {
    const blocker = new PrismaClient();
    const firstRefresh = new PrismaClient();
    const secondRefresh = new PrismaClient();
    const observer = new PrismaClient();
    let releaseBlocker: () => void = () => undefined;
    const blockerRelease = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    let resolveBlockerReady!: (pid: number) => void;
    let rejectBlockerReady!: (error: unknown) => void;
    const blockerReady = new Promise<number>((resolve, reject) => {
      resolveBlockerReady = resolve;
      rejectBlockerReady = reject;
    });
    const blockerWork = blocker.$transaction(async (transaction) => {
      const [row] = await transaction.$queryRaw<BackendPidRow[]>`
        select pg_catalog.pg_backend_pid()::integer as pid
        from public.stalls
        where id = ${stallId}::uuid
        for update
      `;
      if (!row) throw new Error("CAPACITY_REFRESH_BLOCKER_STALL_NOT_FOUND");
      resolveBlockerReady(row.pid);
      await blockerRelease;
    }, { maxWait: 5_000, timeout: 25_000 });
    void blockerWork.catch(rejectBlockerReady);

    let refreshSettled: Promise<PromiseSettledResult<CapacitySnapshotRow[]>[]> | undefined;

    try {
      const [functionRow] = await control.$queryRaw<Array<{ definition: string }>>`
        select pg_catalog.pg_get_functiondef(
          'public.refresh_stall_capacity(uuid,boolean,text)'::regprocedure
        ) as definition
      `;
      if (!functionRow) throw new Error("CAPACITY_REFRESH_FUNCTION_NOT_FOUND");
      expectLockBeforeSnapshot(functionRow.definition);

      const blockerPid = await blockerReady;
      const first = startRefresh(firstRefresh, "E2E_CONCURRENT_REFRESH_FIRST");
      const second = startRefresh(secondRefresh, "E2E_CONCURRENT_REFRESH_SECOND");
      refreshSettled = Promise.allSettled([first.result, second.result]);
      const refreshPids = await Promise.all([first.started, second.started]);

      await expect.poll(async () => {
        const [row] = await observer.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          with recursive wait_chain(pid) as (
            select ${blockerPid}::integer
            union
            select activity.pid
            from pg_catalog.pg_stat_activity activity
            join wait_chain blocker_pid
              on blocker_pid.pid = any(pg_catalog.pg_blocking_pids(activity.pid))
            where activity.datname = current_database()
              and activity.wait_event_type = 'Lock'
          )
          select count(*)::integer as count
          from wait_chain
          where pid in (${Prisma.join(refreshPids)})
        `);
        return row?.count ?? 0;
      }, { timeout: 10_000 }).toBe(2);

      releaseBlocker();
      await blockerWork;
      const outcomes = await refreshSettled;
      const failures = outcomes.flatMap((outcome) => (
        outcome.status === "rejected" ? [formatError(outcome.reason)] : []
      ));
      expect(failures).toEqual([]);

      const snapshots = outcomes.flatMap((outcome) => (
        outcome.status === "fulfilled" ? outcome.value.map((row) => row.snapshot) : []
      ));
      expect(snapshots).toHaveLength(2);

      const [authoritative] = await observer.$queryRaw<CapacitySnapshotRow[]>`
        select public.calculate_stall_capacity(${stallId}::uuid, '[]'::jsonb) as snapshot
      `;
      if (!authoritative) throw new Error("CAPACITY_AUTHORITATIVE_SNAPSHOT_NOT_FOUND");
      for (const snapshot of snapshots) {
        expect(stableSnapshot(snapshot)).toEqual(stableSnapshot(authoritative.snapshot));
      }
      expect(await control.capacityEvent.count({ where: { stallId } })).toBe(0);
    } finally {
      releaseBlocker();
      await Promise.allSettled([
        blockerWork,
        ...(refreshSettled ? [refreshSettled] : []),
      ]);
      await Promise.all([
        blocker.$disconnect(),
        firstRefresh.$disconnect(),
        secondRefresh.$disconnect(),
        observer.$disconnect(),
      ]);
    }
  });
});

function startRefresh(client: PrismaClient, reason: string) {
  let resolveStarted!: (pid: number) => void;
  let rejectStarted!: (error: unknown) => void;
  const started = new Promise<number>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const result = client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("set local lock_timeout = '10s'");
    await transaction.$executeRawUnsafe("set local statement_timeout = '15s'");
    const [row] = await transaction.$queryRaw<BackendPidRow[]>`
      select pg_catalog.pg_backend_pid()::integer as pid
    `;
    if (!row) throw new Error("CAPACITY_REFRESH_BACKEND_PID_NOT_FOUND");
    resolveStarted(row.pid);
    return transaction.$queryRaw<CapacitySnapshotRow[]>(Prisma.sql`
      select public.refresh_stall_capacity(
        ${stallId}::uuid,
        false,
        ${reason}::text
      ) as snapshot
    `);
  }, { maxWait: 5_000, timeout: 20_000 });
  void result.catch(rejectStarted);
  return { result, started };
}

function expectLockBeforeSnapshot(definition: string) {
  const stallLock = definition.search(
    /perform\s+1\s+from\s+public\.stalls\s+where\s+id\s*=\s*p_stall_id\s+for\s+update/iu,
  );
  const settingsRead = definition.search(
    /select\s+\*\s+into\s+v_settings\s+from\s+public\.stall_capacity_settings/iu,
  );
  const snapshotCalculation = definition.search(
    /v_snapshot\s*:=\s*public\.calculate_stall_capacity/iu,
  );

  expect(stallLock).toBeGreaterThanOrEqual(0);
  expect(settingsRead).toBeGreaterThan(stallLock);
  expect(snapshotCalculation).toBeGreaterThan(settingsRead);
}

function stableSnapshot(value: Prisma.JsonValue) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("CAPACITY_SNAPSHOT_INVALID");
  }
  const stable = { ...value };
  delete stable.window_start;
  delete stable.window_end;
  return stable;
}

function formatError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function removeFixture() {
  await control.organization.deleteMany({ where: { id: organizationId } });
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(value).hostname;
  if (!["127.0.0.1", "localhost"].includes(hostname)) {
    throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  if (process.env.DATABASE_URL) return;
  for (const path of [".env.local", ".env"]) {
    try {
      process.loadEnvFile?.(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (process.env.DATABASE_URL) return;
  }
}
