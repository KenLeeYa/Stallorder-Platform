import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { qrProductSelectionControl } from "./local-navigation";
import { createOpenQrFixture } from "./open-qr-fixture";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const flagReason = "P8 E2E local Edge circuit failure injection";
let demoQrToken = "";
const demoOrganizationId = "11111111-1111-4111-8111-111111111111";
const demoStallId = "22222222-2222-4222-8222-222222222222";
let qrFixture: Awaited<
  ReturnType<typeof createOpenQrFixture>
> | null = null;

test.describe("P8 生產韌性故障注入", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    qrFixture = await createOpenQrFixture({
      organizationId: demoOrganizationId,
      stallId: demoStallId,
      tokenPrefix: "e2e-resilience",
      label: "E2E 韌性測試",
    });
    demoQrToken = qrFixture.qrToken;
    await removeTemporaryFlag();
    const [flag, owner] = await Promise.all([
      prisma.resilienceFeatureFlag.findUniqueOrThrow({
        where: { code: "DUAL_ORDER_INTAKE_ENABLED" },
        select: { id: true },
      }),
      prisma.profile.findUniqueOrThrow({
        where: { email: "owner@stallorder.test" },
        select: { id: true },
      }),
    ]);
    await prisma.resilienceFeatureFlagOverride.create({
      data: {
        flagId: flag.id,
        scopeType: "GLOBAL",
        enabled: true,
        reason: flagReason,
        createdByProfileId: owner.id,
        updatedByProfileId: owner.id,
      },
    });
  });

  test.afterAll(async () => {
    try {
      await removeTemporaryFlag();
    } finally {
      try {
        await qrFixture?.restore();
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  test("Supabase Edge 回傳 503 時以同一請求識別轉入 Circuit B", async ({
    page,
  }) => {
    await page.route(
      (url) =>
        [
          "/functions/v1/create-order-session",
          "/api/public-order/create-order-session",
        ].includes(url.pathname),
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "ORDER_CREATE_ERROR",
            error: "Injected local Edge failure",
          }),
        });
      },
    );
    const fallbackResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/public/order-session" &&
        response.request().method() === "POST",
    );

    await page.goto(`/q/${demoQrToken}`);
    const response = await fallbackResponse;

    expect(response.status()).toBe(201);
    expect(response.headers()["x-order-circuit"]).toBe("B");
    await expect(
      qrProductSelectionControl(
        page.getByRole("article").filter({ hasText: "香酥雞排" }),
        "香酥雞排",
      ),
    ).toBeEnabled();
    await expect(page.getByText(/點餐時間剩餘 \d{1,2}:\d{2}/)).toBeVisible();
  });

  test("同一 QR 的三個不同裝置可並行建立安全工作階段", async () => {
    const identities = [
      {
        sessionRequestId: "30000000-0000-4000-8000-000000000001",
        deviceId: "40000000-0000-4000-8000-000000000001",
      },
      {
        sessionRequestId: "30000000-0000-4000-8000-000000000002",
        deviceId: "40000000-0000-4000-8000-000000000002",
      },
      {
        sessionRequestId: "30000000-0000-4000-8000-000000000003",
        deviceId: "40000000-0000-4000-8000-000000000003",
      },
    ].map((identity) => ({
      ...identity,
      sessionTokenHash: sha256(
        `session:${identity.sessionRequestId}:${identity.deviceId}`,
      ),
      ipHash: sha256(`ip:${identity.deviceId}`),
      deviceHash: sha256(`device:${identity.deviceId}`),
      behaviorHash: sha256(
        `scan:${identity.sessionRequestId}:${identity.deviceId}`,
      ),
    }));
    const requestIds = identities.map((identity) => identity.sessionRequestId);
    const sessionTokenHashes = identities.map(
      (identity) => identity.sessionTokenHash,
    );
    const qrTokenHash = sha256(`qr:${demoQrToken}`);
    const rateLimitHashes = [
      ...identities.flatMap((identity) => [
        identity.ipHash,
        identity.deviceHash,
        identity.behaviorHash,
      ]),
      qrTokenHash,
      sha256(demoStallId),
    ];
    await cleanupConcurrentSessionState(
      requestIds,
      sessionTokenHashes,
      rateLimitHashes,
    );
    const blocker = new PrismaClient();
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
    const blockerWork = blocker
      .$transaction(
        async (transaction) => {
          const [row] = await transaction.$queryRaw<Array<{ pid: number }>>`
        select pg_catalog.pg_backend_pid()::integer as pid
        from public.stalls
        where id = ${demoStallId}::uuid
        for update
      `;
          if (!row) throw new Error("E2E_BLOCKER_STALL_NOT_FOUND");
          resolveBlockerReady(row.pid);
          await blockerRelease;
        },
        { maxWait: 5_000, timeout: 20_000 },
      )
      .catch((error) => {
        rejectBlockerReady(error);
        throw error;
      });
    let sessionWork: Array<Promise<SessionIssueRow[]>> = [];

    try {
      const blockerPid = await blockerReady;
      sessionWork = identities.map(
        async (identity) =>
          await sessionClient.$queryRaw<SessionIssueRow[]>(Prisma.sql`
          select public.issue_idempotent_order_session_with_schedule(
            ${demoQrToken}::text,
            ${identity.sessionTokenHash}::text,
            ${identity.ipHash}::text,
            ${identity.deviceHash}::text,
            ${qrTokenHash}::text,
            ${identity.behaviorHash}::text,
            ${identity.sessionRequestId}::text,
            'DEFAULT'::text
          ) as result
        `),
      );

      await expect
        .poll(
          async () => {
            const [row] = await observer.$queryRaw<
              Array<{ count: number }>
            >(Prisma.sql`
          with recursive wait_chain(pid) as (
            select ${blockerPid}::integer
            union
            select activity.pid
            from pg_catalog.pg_stat_activity activity
            join wait_chain blocker
              on blocker.pid = any(pg_catalog.pg_blocking_pids(activity.pid))
            where activity.datname = current_database()
              and activity.wait_event_type = 'Lock'
              and activity.query like '%issue_idempotent_order_session_with_schedule%'
          )
          select (count(*) - 1)::integer as count
          from wait_chain
        `);
            return row?.count ?? 0;
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThanOrEqual(3);

      releaseBlocker();
      await blockerWork;
      const outcomes = await Promise.allSettled(sessionWork);
      expect(
        outcomes.filter((outcome) => outcome.status === "rejected"),
      ).toEqual([]);
      const results = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? outcome.value : [],
      );
      expect(results).toHaveLength(3);
      const sessionIds = results.map((row) => {
        expect(row.result).toMatchObject({ ok: true });
        expect(row.result?.idempotent_replay).not.toBe(true);
        expect(row.result?.order_session_id).toEqual(expect.any(String));
        return row.result?.order_session_id;
      });
      expect(new Set(sessionIds).size).toBe(3);
    } finally {
      releaseBlocker();
      await Promise.allSettled([blockerWork, ...sessionWork]);
      await cleanupConcurrentSessionState(
        requestIds,
        sessionTokenHashes,
        rateLimitHashes,
      );
      await Promise.all([
        blocker.$disconnect(),
        sessionClient.$disconnect(),
        observer.$disconnect(),
      ]);
    }
  });

  test("SSE 與 Realtime 同時失效時顯示 5 秒輪詢並持續抓取訂單", async ({
    page,
  }) => {
    let orderListRequests = 0;
    await page.route("**/api/stalls/*/orders/stream", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected local SSE failure" }),
      });
    });
    await page.routeWebSocket("**/realtime/v1/**", (socket) => socket.close());
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "GET" &&
        url.pathname === "/api/stalls/aming-chicken/orders"
      ) {
        orderListRequests += 1;
      }
    });

    await login(page, "staff@stallorder.test", /\/staff\/aming-chicken/);

    await expect(
      page.locator('[title="SSE 與 Realtime 未就緒，已啟用 5 秒輪詢"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => orderListRequests, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);
  });
});

async function removeTemporaryFlag() {
  const flag = await prisma.resilienceFeatureFlag.findUnique({
    where: { code: "DUAL_ORDER_INTAKE_ENABLED" },
    select: { id: true },
  });
  if (!flag) return;
  await prisma.resilienceFeatureFlagOverride.deleteMany({
    where: { flagId: flag.id, reason: flagReason },
  });
}

async function login(page: Page, email: string, expectedUrl: RegExp) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "使用電子郵件與密碼登入", exact: true })
    .click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(expectedUrl, { timeout: 30_000 });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] =
      value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
}

type SessionIssueRow = {
  result: {
    ok?: boolean;
    code?: string;
    order_session_id?: string;
    idempotent_replay?: boolean;
  } | null;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function cleanupConcurrentSessionState(
  requestIds: string[],
  sessionTokenHashes: string[],
  rateLimitHashes: string[],
) {
  await prisma.publicOrderAttempt.deleteMany({
    where: { requestId: { in: requestIds } },
  });
  await prisma.orderSession.deleteMany({
    where: { tokenHash: { in: sessionTokenHashes } },
  });
  await prisma.publicRateLimitBucket.deleteMany({
    where: {
      stallId: demoStallId,
      dimensionHash: { in: rateLimitHashes },
    },
  });
}
