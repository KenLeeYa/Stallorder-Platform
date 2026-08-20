import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const control = new PrismaClient();
const organizationId = "a5000000-0000-4000-8000-000000000001";
const stallId = "a5000000-0000-4000-8000-000000000002";
const locationId = "a5000000-0000-4000-8000-000000000003";
const scheduleId = "a5000000-0000-4000-8000-000000000004";
const qrCodeId = "a5000000-0000-4000-8000-000000000005";
const orderSessionId = "a5000000-0000-4000-8000-000000000006";
const qrToken = "targeted-stall-schedule-concurrency-qr-2026";
const sessionTokenHash = "s".repeat(64);
const deviceHash = "d".repeat(64);

type BackendPidRow = { pid: number };
type JsonResultRow = { result: Prisma.JsonValue };

test.describe.serial("targeted stall schedule lock order", () => {
  test.beforeAll(async () => {
    await removeFixture();
    const now = new Date();
    const startsAt = new Date(now.getTime() - 2 * 60 * 60_000);
    const endsAt = new Date(now.getTime() + 60 * 60_000);

    await control.$transaction(async (transaction) => {
      await transaction.organization.create({
        data: {
          id: organizationId,
          name: "Targeted schedule concurrency",
          slug: "targeted-schedule-concurrency",
          businessName: "Targeted schedule concurrency",
          status: "ACTIVE",
          email: "targeted-schedule-concurrency@stallorder.test",
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
          name: "Targeted schedule stall",
          slug: "targeted-schedule-concurrency-stall",
          code: "TARGET-SCHEDULE-CONCURRENCY",
          address: "Local database only",
          location: "Local database only",
          businessStatus: "OPEN",
          orderingEnabled: true,
          orderingState: "OPEN",
        },
      });
      await transaction.stallCapacitySettings.update({
        where: { stallId },
        data: {
          pauseSource: "NONE",
          autoPauseEnabled: false,
          autoResumeEnabled: false,
          manualWaitMinutes: 10,
        },
      });
      await transaction.stallLocation.create({
        data: {
          id: locationId,
          organizationId,
          stallId,
          name: "Targeted schedule location",
          address: "Local database only",
        },
      });
      await transaction.stallSchedule.create({
        data: {
          id: scheduleId,
          organizationId,
          stallId,
          locationId,
          startsAt,
          endsAt,
          orderingOpensAt: startsAt,
          orderingClosesAt: endsAt,
          status: "OPEN",
          autoOpenEnabled: true,
          autoCloseEnabled: true,
        },
      });
      await transaction.qrCode.create({
        data: {
          id: qrCodeId,
          organizationId,
          stallId,
          locationId,
          stallScheduleId: scheduleId,
          fulfillmentTypeContext: "TAKEOUT",
          token: qrToken,
          label: "Targeted schedule QR",
          state: "ACTIVE",
        },
      });
      await transaction.orderSession.create({
        data: {
          id: orderSessionId,
          organizationId,
          stallId,
          qrCodeId,
          tokenHash: sessionTokenHash,
          deviceHash,
          ipHash: "i".repeat(64),
          status: "ACTIVE",
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          orderingMode: "DEFAULT",
          locationId,
          stallScheduleId: scheduleId,
          fulfillmentTypeContext: "TAKEOUT",
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

  test("capacity refresh and session replay serialize on the stall without deadlock", async () => {
    const blocker = new PrismaClient();
    const capacityClient = new PrismaClient();
    const sessionClient = new PrismaClient();
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
      if (!row) throw new Error("TARGETED_SCHEDULE_BLOCKER_STALL_NOT_FOUND");
      resolveBlockerReady(row.pid);
      await blockerRelease;
    }, { maxWait: 5_000, timeout: 25_000 });
    void blockerWork.catch(rejectBlockerReady);

    let concurrentWork: Promise<PromiseSettledResult<JsonResultRow[]>[]> | undefined;
    try {
      const definitions = await effectiveDefinitions();
      expectStallFirst(definitions.targeted, /from public\.stall_schedules schedule/iu);
      expectStallFirst(
        definitions.session,
        /app_private\.process_stall_schedules_for_stall\(/iu,
      );

      const blockerPid = await blockerReady;
      await control.stallSchedule.update({
        where: { id: scheduleId },
        data: { orderingClosesAt: new Date(Date.now() - 60_000) },
      });
      const capacity = startCapacityRefresh(capacityClient);
      const session = startSessionReplay(sessionClient);
      concurrentWork = Promise.allSettled([capacity.result, session.result]);
      const workerPids = await Promise.all([capacity.started, session.started]);

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
          where pid in (${Prisma.join(workerPids)})
        `);
        return row?.count ?? 0;
      }, { timeout: 10_000 }).toBe(2);

      releaseBlocker();
      await blockerWork;
      const outcomes = await concurrentWork;
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([]);

      const schedule = await observer.stallSchedule.findUniqueOrThrow({
        where: { id: scheduleId },
        select: { status: true },
      });
      const stall = await observer.stall.findUniqueOrThrow({
        where: { id: stallId },
        select: { orderingState: true },
      });
      const sessionState = await observer.orderSession.findUniqueOrThrow({
        where: { id: orderSessionId },
        select: { status: true },
      });
      expect(schedule.status).toBe("COMPLETED");
      expect(stall.orderingState).toBe("CLOSED");
      expect(sessionState.status).toBe("REVOKED");
    } finally {
      releaseBlocker();
      await Promise.allSettled([
        blockerWork,
        ...(concurrentWork ? [concurrentWork] : []),
      ]);
      await Promise.all([
        blocker.$disconnect(),
        capacityClient.$disconnect(),
        sessionClient.$disconnect(),
        observer.$disconnect(),
      ]);
    }
  });
});

function startCapacityRefresh(client: PrismaClient) {
  return startDatabaseWork(client, (transaction) => transaction.$queryRaw<JsonResultRow[]>(Prisma.sql`
    select public.refresh_stall_capacity(
      ${stallId}::uuid,
      false,
      'TARGETED_SCHEDULE_CONCURRENCY'::text
    ) as result
  `));
}

function startSessionReplay(client: PrismaClient) {
  return startDatabaseWork(client, (transaction) => transaction.$queryRaw<JsonResultRow[]>(Prisma.sql`
    select public.issue_idempotent_order_session_with_schedule_targeted(
      ${qrToken}::text,
      ${sessionTokenHash}::text,
      ${"i".repeat(64)}::text,
      ${deviceHash}::text,
      ${"q".repeat(64)}::text,
      ${"b".repeat(64)}::text,
      'targeted-schedule-concurrency'::text,
      'DEFAULT'::text
    ) as result
  `));
}

function startDatabaseWork(
  client: PrismaClient,
  query: (transaction: Prisma.TransactionClient) => Promise<JsonResultRow[]>,
) {
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
    if (!row) throw new Error("TARGETED_SCHEDULE_BACKEND_PID_NOT_FOUND");
    resolveStarted(row.pid);
    return query(transaction);
  }, { maxWait: 5_000, timeout: 20_000 });
  void result.catch(rejectStarted);
  return { result, started };
}

async function effectiveDefinitions() {
  const [targeted] = await control.$queryRaw<Array<{ definition: string }>>`
    select pg_catalog.pg_get_functiondef(
      'app_private.process_stall_schedules_for_stall(uuid,timestamptz)'::regprocedure
    ) as definition
  `;
  const [session] = await control.$queryRaw<Array<{ definition: string }>>`
    select pg_catalog.pg_get_functiondef(
      'public.issue_idempotent_order_session_with_schedule_targeted(text,text,text,text,text,text,text,text)'::regprocedure
    ) as definition
  `;
  if (!targeted || !session) throw new Error("TARGETED_SCHEDULE_FUNCTION_DEFINITION_NOT_FOUND");
  return { targeted: targeted.definition, session: session.definition };
}

function expectStallFirst(definition: string, laterLock: RegExp) {
  const stallLock = definition.search(
    /(?:from|join) public\.stalls stall[\s\S]*for update(?: of stall)?/iu,
  );
  const laterLockIndex = definition.search(laterLock);
  expect(stallLock).toBeGreaterThanOrEqual(0);
  expect(laterLockIndex).toBeGreaterThan(stallLock);
}

async function removeFixture() {
  await control.organization.deleteMany({ where: { id: organizationId } });
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Targeted schedule E2E requires DATABASE_URL");
  const hostname = new URL(value).hostname;
  if (!["127.0.0.1", "localhost"].includes(hostname)) {
    throw new Error(`Refusing to run targeted schedule E2E against ${hostname}`);
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
