import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const deviceName = "P4 E2E 離線主機";
const flagReason = "P4 E2E temporary offline device validation";

test.describe("P4 離線 PWA 基礎", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await cleanup();
    const [flag, owner] = await Promise.all([
      prisma.resilienceFeatureFlag.findUniqueOrThrow({
        where: { code: "OFFLINE_POS_ENABLED" },
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
        scopeType: "STALL",
        organizationId,
        stallId,
        enabled: true,
        reason: flagReason,
        createdByProfileId: owner.id,
        updatedByProfileId: owner.id,
      },
    });
  });

  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test("裝置須由管理者指定唯一 Leader 後才取得離線 Permit", async ({ browser }, testInfo) => {
    const staffContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const ownerContext = await browser.newContext({
      viewport: { width: 430, height: 932 },
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const staffPage = await staffContext.newPage();
    const ownerPage = await ownerContext.newPage();

    try {
      await login(staffPage, "staff@stallorder.test", /\/staff\/aming-chicken/);
      await staffPage.goto(`/staff/${stallSlug}`);
      const staffBoard = staffPage.locator("main:visible").last();
      await staffBoard.getByTitle("離線裝置").click();
      await staffBoard.getByLabel("裝置名稱").fill(deviceName);
      await staffBoard.getByRole("button", { name: "登錄並準備離線資料" }).click();
      await expect(staffBoard.getByText(/裝置已送出登錄/)).toBeVisible();

      const device = await prisma.clientDevice.findFirstOrThrow({
        where: { organizationId, stallId, displayName: deviceName },
      });
      expect(device.status).toBe("DISABLED");
      expect(device.offlineRole).toBe("NONE");
      expect(device.offlineEnabled).toBe(false);

      await login(ownerPage, "owner@stallorder.test", /\/merchant\/dashboard/);
      await ownerPage.goto(`/merchant/stalls/${stallId}/offline`);
      const ownerSettings = ownerPage.locator("main:visible").last();
      await expect(ownerSettings.getByRole("heading", { name: "離線裝置" })).toBeVisible();
      await expect(ownerSettings.getByRole("heading", { name: deviceName, exact: true })).toBeVisible();
      await ownerSettings.getByRole("switch", { name: "允許離線收單" }).check();
      await ownerSettings.getByLabel("Leader 裝置").selectOption(device.id);
      await ownerSettings.getByLabel("異動原因").fill("核准本機 E2E 離線主機測試");
      await ownerSettings.getByRole("button", { name: "儲存離線政策" }).click();
      await expect(ownerSettings.getByRole("status")).toContainText("離線裝置設定已更新");
      expect(await ownerPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      )).toBe(true);
      await ownerPage.screenshot({
        path: testInfo.outputPath("offline-device-mobile.png"),
        fullPage: false,
      });

      const approved = await prisma.clientDevice.findUniqueOrThrow({ where: { id: device.id } });
      expect(approved.status).toBe("ACTIVE");
      expect(approved.offlineRole).toBe("OFFLINE_LEADER");
      expect(approved.offlineEnabled).toBe(true);

      await staffBoard.getByRole("button", { name: "登錄並準備離線資料" }).click();
      await expect(staffBoard.getByText(/離線資料已安全儲存/)).toBeVisible();
      const localData = await staffPage.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
          const request = indexedDB.open("stallorder-offline-pos");
          request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
          request.addEventListener("error", () => reject(request.error), { once: true });
        });
        try {
          const stores = [
            "device_profile",
            "offline_permit",
            "menu_snapshots",
            "stall_settings",
            "availability_config",
          ];
          const transaction = database.transaction(stores, "readonly");
          const counts = await Promise.all(stores.map((storeName) => new Promise<number>((resolveCount, reject) => {
            const request = transaction.objectStore(storeName).count();
            request.addEventListener("success", () => resolveCount(request.result), { once: true });
            request.addEventListener("error", () => reject(request.error), { once: true });
          })));
          return { storeCount: database.objectStoreNames.length, counts };
        } finally {
          database.close();
        }
      });
      expect(localData.storeCount).toBe(15);
      expect(localData.counts).toEqual([1, 1, 1, 1, 1]);

      const permit = await prisma.offlinePermit.findFirstOrThrow({
        where: { deviceId: device.id, status: "ACTIVE" },
      });
      expect(permit.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(permit.expiresAt.getTime() - permit.issuedAt.getTime()).toBeLessThanOrEqual(12 * 60 * 60_000);

      const snapshot = await prisma.menuSnapshot.findUniqueOrThrow({
        where: { id: permit.menuSnapshotId },
      });
      expect(snapshot.publicContentHash).toMatch(/^[a-f0-9]{64}$/);
      const manifest = await prisma.storageObjectManifest.findUniqueOrThrow({
        where: {
          bucket_objectPath: {
            bucket: "offline-menu-snapshots",
            objectPath: snapshot.publicObjectPath,
          },
        },
      });
      expect(manifest.contentType).toBe("application/json");

      const publicSnapshotResponse = await staffPage.request.get(
        `/api/assets/offline-menus/${snapshot.publicObjectPath}`,
      );
      expect(publicSnapshotResponse.ok()).toBe(true);
      expect(publicSnapshotResponse.headers()["cache-control"]).toContain("immutable");
      const publicSnapshot = await publicSnapshotResponse.json();
      expect(publicSnapshot).toMatchObject({
        schemaVersion: 1,
        snapshot: {
          version: snapshot.version,
          contentHash: snapshot.publicContentHash,
        },
      });
      expect(JSON.stringify(publicSnapshot)).not.toMatch(
        /password|session|permitToken|serviceRole|customerPhone/i,
      );
    } finally {
      await staffContext.close();
      await ownerContext.close();
    }
  });
});

async function cleanup() {
  const flag = await prisma.resilienceFeatureFlag.findUnique({
    where: { code: "OFFLINE_POS_ENABLED" },
    select: { id: true },
  });
  if (flag) {
    await prisma.resilienceFeatureFlagOverride.deleteMany({
      where: { flagId: flag.id, organizationId, stallId, reason: flagReason },
    });
  }
  const devices = await prisma.clientDevice.findMany({
    where: { organizationId, stallId, displayName: deviceName },
    select: { id: true },
  });
  const deviceIds = devices.map((device) => device.id);
  const permits = deviceIds.length > 0
    ? await prisma.offlinePermit.findMany({
      where: { organizationId, stallId, deviceId: { in: deviceIds } },
      select: { menuSnapshotId: true },
    })
    : [];
  const snapshotIds = [...new Set(permits.map((permit) => permit.menuSnapshotId))];
  if (deviceIds.length > 0) {
    await prisma.offlinePermit.deleteMany({
      where: { organizationId, stallId, deviceId: { in: deviceIds } },
    });
  }
  await prisma.offlineStallRuntimePolicy.deleteMany({ where: { organizationId, stallId } });
  if (deviceIds.length > 0) {
    await prisma.clientDevice.deleteMany({ where: { id: { in: deviceIds } } });
  }
  const snapshots = await prisma.menuSnapshot.findMany({
    where: { id: { in: snapshotIds } },
    select: { id: true, publicObjectPath: true },
  });
  if (snapshots.length > 0) {
    await prisma.menuSnapshot.deleteMany({
      where: { id: { in: snapshots.map((snapshot) => snapshot.id) } },
    });
    await prisma.storageObjectManifest.deleteMany({
      where: {
        bucket: "offline-menu-snapshots",
        objectPath: { in: snapshots.map((snapshot) => snapshot.publicObjectPath) },
      },
    });
  }
}

async function login(page: Page, email: string, expectedUrl: RegExp) {
  await page.goto("/login");
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
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  }
}
