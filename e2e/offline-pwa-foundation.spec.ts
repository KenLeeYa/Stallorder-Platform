import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { offlineSyncRequestSchema } from "../src/offline/offline-order-contract";
import { gotoLocalPath } from "./local-navigation";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const deviceName = "P4 E2E 離線主機";
const flagReason = "P4 E2E temporary offline device validation";
const offlineCustomerName = "P5 E2E 離線顧客";
const productionOfflineRuntime = process.env.PLAYWRIGHT_PRODUCTION_SERVER === "true";

async function waitForReactHandler(control: Locator, handler: "onClick" | "onChange") {
  await expect.poll(() => control.evaluate((element, eventName) => {
    const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
    if (!propsKey) return false;
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    return typeof props === "object"
      && props !== null
      && typeof (props as Record<string, unknown>)[eventName] === "function";
  }, handler), { message: `等待 React 掛載 ${handler}` }).toBe(true);
}

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
    test.setTimeout(productionOfflineRuntime ? 60_000 : 180_000);
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
    let staffPage = await staffContext.newPage();
    const ownerPage = await ownerContext.newPage();
    let offlineIdempotencyKey: string | null = null;

    try {
      await login(staffPage, "staff@stallorder.test", /\/staff\/aming-chicken/);
      if (!productionOfflineRuntime) {
        for (const path of [
          `/api/stalls/${stallSlug}/offline/devices`,
          `/api/stalls/${stallSlug}/offline/bootstrap`,
          "/api/offline/sync",
        ]) {
          const warmupResponse = await staffContext.request.get(path);
          expect(warmupResponse.status()).toBe(405);
          await warmupResponse.dispose();
        }
        const assetWarmupResponse = await staffContext.request.get(
          "/api/assets/offline-menus/e2e-warmup",
        );
        expect(assetWarmupResponse.status()).toBe(404);
        await assetWarmupResponse.dispose();
      }
      await gotoLocalPath(staffPage, `/staff/${stallSlug}`);
      const staffBoard = staffPage.locator("main:visible").last();
      const offlineDeviceButton = staffBoard.getByTitle("離線裝置", { exact: true });
      await waitForReactHandler(offlineDeviceButton, "onClick");
      await offlineDeviceButton.click();
      const deviceNameInput = staffBoard.getByLabel("裝置名稱");
      await waitForReactHandler(deviceNameInput, "onChange");
      await deviceNameInput.fill(deviceName);
      const registerDeviceButton = staffBoard.getByRole("button", { name: "登錄並準備離線資料" });
      await waitForReactHandler(registerDeviceButton, "onClick");
      const registerDeviceResponse = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/stalls/${stallSlug}/offline/devices`
        && response.request().method() === "POST"
        && response.request().postDataJSON()?.displayName === deviceName
      ));
      await registerDeviceButton.click();
      expect((await registerDeviceResponse).status()).toBe(202);
      await expect(staffBoard.getByText(/裝置已送出登錄/)).toBeVisible();

      const device = await prisma.clientDevice.findFirstOrThrow({
        where: { organizationId, stallId, displayName: deviceName },
      });
      expect(device.status).toBe("DISABLED");
      expect(device.offlineRole).toBe("NONE");
      expect(device.offlineEnabled).toBe(false);
      await prisma.offlineSyncConflict.create({
        data: {
          organizationId,
          stallId,
          deviceId: device.id,
          localEntityId: randomUUID(),
          conflictType: "PRICE_CHANGED",
          detailsJson: { errorCode: "E2E_INVALID_SUBMIT" },
        },
      });

      await login(ownerPage, "owner@stallorder.test", /\/merchant\/dashboard\?organizationId=/);
      if (!productionOfflineRuntime) {
        for (const path of [
          `/api/merchant/stalls/${stallId}/offline`,
          `/api/merchant/stalls/${stallId}/offline/conflicts`,
        ]) {
          const warmupResponse = await ownerContext.request.get(path);
          expect(warmupResponse.status()).toBe(200);
          await warmupResponse.dispose();
        }
      }
      await gotoLocalPath(ownerPage, `/merchant/stalls/${stallId}/offline`);
      const ownerSettings = ownerPage.locator("main:visible").last();
      await expect(ownerSettings.getByRole("heading", { name: "離線裝置" })).toBeVisible();
      await expect(ownerSettings.getByRole("heading", { name: deviceName, exact: true })).toBeVisible();

      const policyReasonField = ownerSettings.getByLabel("異動原因");
      const saveOfflinePolicyButton = ownerSettings.getByRole("button", { name: "儲存離線政策" });
      await waitForReactHandler(saveOfflinePolicyButton, "onClick");
      const blankPolicyResponse = ownerPage.waitForResponse((response) => (
        response.url().endsWith(`/api/merchant/stalls/${stallId}/offline`)
        && response.request().method() === "PATCH"
      ));
      await saveOfflinePolicyButton.click();
      expect((await blankPolicyResponse).status()).toBe(400);
      await expect(ownerSettings.getByText("異動原因不可空白。", { exact: true }).first()).toBeVisible();
      await expect(policyReasonField).toHaveAttribute("aria-invalid", "true");
      await expect(policyReasonField).toBeFocused();

      await ownerSettings.getByRole("switch", { name: "允許離線收單" }).check();
      await ownerSettings.getByLabel("Leader 裝置").selectOption(device.id);
      await policyReasonField.fill("核准本機 E2E 離線主機測試");
      const updatePolicyResponse = ownerPage.waitForResponse((response) => (
        response.url().endsWith(`/api/merchant/stalls/${stallId}/offline`)
        && response.request().method() === "PATCH"
        && response.request().postDataJSON()?.operation === "UPDATE_POLICY"
        && response.request().postDataJSON()?.reason === "核准本機 E2E 離線主機測試"
      ));
      await saveOfflinePolicyButton.click();
      expect((await updatePolicyResponse).status()).toBe(200);
      await expect(ownerSettings.getByRole("status")).toContainText("離線裝置設定已更新");

      const conflictCard = ownerSettings
        .getByRole("article")
        .filter({ hasText: deviceName })
        .filter({ hasText: "E2E_INVALID_SUBMIT" });
      const resolutionField = conflictCard.getByLabel("處理結果");
      const blankConflictResponse = ownerPage.waitForResponse((response) => (
        response.url().endsWith(`/api/merchant/stalls/${stallId}/offline/conflicts`)
        && response.request().method() === "PATCH"
      ));
      await conflictCard.getByRole("button", { name: "確認處理" }).click();
      expect((await blankConflictResponse).status()).toBe(400);
      await expect(conflictCard.getByText("「處理結果」輸入不正確，請依欄位限制重新輸入。", { exact: true })).toBeVisible();
      await expect(resolutionField).toHaveAttribute("aria-invalid", "true");
      await expect(resolutionField).toBeFocused();

      await resolutionField.selectOption("ACCEPTED_LOCAL");
      const blankConflictReasonResponse = ownerPage.waitForResponse((response) => (
        response.url().endsWith(`/api/merchant/stalls/${stallId}/offline/conflicts`)
        && response.request().method() === "PATCH"
      ));
      await conflictCard.getByRole("button", { name: "確認處理" }).click();
      expect((await blankConflictReasonResponse).status()).toBe(400);
      const conflictReasonField = conflictCard.getByLabel("處理原因");
      await expect(conflictCard.getByText("處理原因不可空白。", { exact: true })).toBeVisible();
      await expect(conflictReasonField).toHaveAttribute("aria-invalid", "true");
      await expect(conflictReasonField).toBeFocused();
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

      const offlineDeviceTrigger = staffBoard.getByTitle("離線裝置", { exact: true });
      if (await offlineDeviceTrigger.getAttribute("aria-expanded") !== "true") {
        await waitForReactHandler(offlineDeviceTrigger, "onClick");
        await offlineDeviceTrigger.click();
        await expect(offlineDeviceTrigger).toHaveAttribute("aria-expanded", "true");
      }
      const approvedDeviceNameInput = staffBoard.getByLabel("裝置名稱");
      await waitForReactHandler(approvedDeviceNameInput, "onChange");
      await approvedDeviceNameInput.fill(deviceName);
      const prepareOfflineDataButton = staffBoard.getByRole("button", { name: "登錄並準備離線資料" });
      await expect(prepareOfflineDataButton).toBeVisible();
      await waitForReactHandler(prepareOfflineDataButton, "onClick");
      const approvedDeviceResponse = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/stalls/${stallSlug}/offline/devices`
        && response.request().method() === "POST"
        && response.request().postDataJSON()?.displayName === deviceName
      ));
      const bootstrapResponse = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/stalls/${stallSlug}/offline/bootstrap`
        && response.request().method() === "POST"
      ));
      await prepareOfflineDataButton.click();
      expect((await approvedDeviceResponse).status()).toBe(200);
      expect((await bootstrapResponse).status()).toBe(200);
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
            "cash_shift_snapshot",
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
      expect(localData.counts).toEqual([1, 1, 1, 1, 1, 1]);

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
      if (!productionOfflineRuntime) return;

      await staffPage.getByTitle("關閉離線裝置視窗").click();
      await staffPage.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await staffPage.reload();
      await expect(staffPage.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
      await expect.poll(
        () => staffPage.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      ).toBe(true);

      await gotoLocalPath(staffPage, "/offline");
      await expect(staffPage.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
      await staffContext.setOffline(true);
      await staffPage.reload({ waitUntil: "domcontentloaded" });
      await expect(staffPage.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
      await expect(staffPage.getByText("目前離線", { exact: true })).toBeVisible();
      await staffPage.getByRole("button", { name: "新增現場訂單" }).click();
      const composer = staffPage.getByRole("dialog", { name: "店員點餐" });
      await composer.getByLabel("顧客名稱（選填）").fill(offlineCustomerName);
      await composer.getByTitle(/^增加 /).first().click();
      const noteGroups = composer.locator("fieldset");
      for (let index = 0; index < await noteGroups.count(); index += 1) {
        const group = noteGroups.nth(index);
        if ((await group.locator("legend").innerText()).includes("*")) {
          await group.locator("input").first().check();
        }
      }
      await composer.getByRole("button", { name: "加入購物車", exact: true }).click();
      await expect(composer.getByTestId("staff-cart-line")).toHaveCount(1);
      await composer.getByTestId("staff-order-cart-tab").click();
      await composer.getByRole("button", { name: "稍後結帳" }).click();
      await composer.getByRole("button", { name: "建立訂單送入廚房" }).click();
      await expect(composer).toBeHidden();

      const localCard = staffPage.getByTestId("offline-order-card").filter({
        hasText: offlineCustomerName,
      });
      await expect(localCard).toBeVisible();
      const localNumber = await localCard.getByTestId("offline-order-number").innerText();
      expect(localNumber).toMatch(/^OFF-[A-F0-9]{6}-[0-9]{8}-[0-9]+$/);
      const localIdentity = await staffPage.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
          const request = indexedDB.open("stallorder-offline-pos");
          request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
          request.addEventListener("error", () => reject(request.error), { once: true });
        });
        try {
          const transaction = database.transaction("offline_orders", "readonly");
          const records = await new Promise<Array<{
            payload?: { customerLabel?: string; idempotencyKey?: string };
          }>>((resolveRecords, reject) => {
            const request = transaction.objectStore("offline_orders").getAll();
            request.addEventListener("success", () => resolveRecords(request.result), { once: true });
            request.addEventListener("error", () => reject(request.error), { once: true });
          });
          return records.find((record) => record.payload?.customerLabel === "P5 E2E 離線顧客")
            ?.payload?.idempotencyKey ?? null;
        } finally {
          database.close();
        }
      });
      expect(localIdentity).toMatch(/^[0-9a-f-]{36}$/);
      if (!localIdentity) throw new Error("離線訂單未寫入本機冪等鍵");
      offlineIdempotencyKey = localIdentity;

      expect(await serviceWorkerPendingRecords(staffPage)).toBeGreaterThan(0);
      await staffPage.close();
      staffPage = await staffContext.newPage();
      await gotoLocalPath(staffPage, "/offline");
      const persistedCard = staffPage.getByTestId("offline-order-card").filter({
        hasText: localNumber,
      });
      await expect(persistedCard).toBeVisible();
      await persistedCard.getByRole("button", { name: "開始製作" }).click();
      await expect(persistedCard.getByText("製作中", { exact: true })).toBeVisible();
      await persistedCard.getByRole("button", { name: "餐點完成" }).click();
      await expect(persistedCard.getByText("待結帳", { exact: true })).toBeVisible();

      await staffPage.evaluate(() => {
        const originalFetch = window.fetch.bind(window);
        const captureWindow = window as typeof window & {
          __offlineSyncPayload?: unknown;
        };
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = input instanceof Request ? input.url : String(input);
          const method = (init?.method ?? (input instanceof Request ? input.method : "GET"))
            .toUpperCase();
          if (
            method === "POST"
            && new URL(url, window.location.origin).pathname === "/api/offline/sync"
            && typeof init?.body === "string"
          ) {
            captureWindow.__offlineSyncPayload = JSON.parse(init.body);
          }
          return originalFetch(input, init);
        };
      });
      await staffContext.setOffline(false);
      await expect(staffPage.getByText("網路已恢復", { exact: true })).toBeVisible();
      await staffPage.waitForTimeout(5_000);
      const autoSyncStarted = await staffPage.evaluate(() => Boolean((
        window as typeof window & { __offlineSyncPayload?: unknown }
      ).__offlineSyncPayload));
      if (!autoSyncStarted) {
        await staffPage.getByRole("button", { name: "立即同步" }).click();
      }
      await expect.poll(async () => staffPage.evaluate(() => Boolean((
        window as typeof window & { __offlineSyncPayload?: unknown }
      ).__offlineSyncPayload)), {
        timeout: 10_000,
      }).toBe(true);
      const syncPayload = await staffPage.evaluate(() => (
        window as typeof window & { __offlineSyncPayload?: unknown }
      ).__offlineSyncPayload);
      const syncRequestValidation = offlineSyncRequestSchema.safeParse(syncPayload);
      expect(
        syncRequestValidation.success,
        syncRequestValidation.success
          ? undefined
          : syncRequestValidation.error.issues
            .map((issue) => {
              const safeMessage = /^[A-Z0-9_]{1,120}$/.test(issue.message)
                ? `:${issue.message}`
                : "";
              return `${issue.path.join(".") || "<root>"}:${issue.code}${safeMessage}`;
            })
            .join(", "),
      ).toBe(true);
      await expect(staffPage.getByText(/目前沒有待同步的本機訂單/)).toBeVisible({
        timeout: 30_000,
      });
      expect(syncPayload).toBeTruthy();
      expect(await serviceWorkerPendingRecords(staffPage)).toBe(0);

      const importedOrders = await prisma.order.findMany({
        where: {
          organizationId,
          stallId,
          idempotencyKey: localIdentity,
        },
        select: { id: true, origin: true, status: true },
      });
      expect(importedOrders).toHaveLength(1);
      expect(importedOrders[0]).toMatchObject({
        origin: "OFFLINE_POS",
        status: "READY",
      });

      const duplicateResult = await staffPage.evaluate(async ({ body, slug }) => {
        const csrf = document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("stallorder_csrf="))
          ?.split("=").slice(1).join("=");
        const response = await fetch("/api/offline/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": decodeURIComponent(csrf ?? ""),
            "x-stall-slug": slug,
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        return {
          status: response.status,
          outcome: payload.receipts?.[0]?.outcome ?? null,
        };
      }, { body: syncPayload, slug: stallSlug });
      expect(duplicateResult).toEqual({ status: 200, outcome: "DUPLICATE" });
      expect(await prisma.order.count({
        where: {
          organizationId,
          stallId,
          idempotencyKey: localIdentity,
        },
      })).toBe(1);
    } finally {
      if (offlineIdempotencyKey) {
        await cleanupSyncedOfflineOrder(offlineIdempotencyKey);
      }
      await staffContext.close();
      await ownerContext.close();
    }
  });
});

async function serviceWorkerPendingRecords(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    if (!worker) throw new Error("Service Worker 尚未控制頁面");
    return new Promise<number>((resolvePending, reject) => {
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        reject(new Error("Service Worker 安全檢查逾時"));
      }, 5_000);
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type !== "SW_UPDATE_SAFETY") return;
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolvePending(Number(event.data.pendingRecords));
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      worker.postMessage({ type: "CHECK_UPDATE_SAFETY" });
    });
  });
}

async function cleanupSyncedOfflineOrder(idempotencyKey: string) {
  const orders = await prisma.order.findMany({
    where: { organizationId, stallId, idempotencyKey },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  await prisma.$transaction([
    prisma.offlineSyncConflict.deleteMany({
      where: { organizationId, stallId, orderId: { in: orderIds } },
    }),
    prisma.offlineOrderSyncReceipt.deleteMany({
      where: { organizationId, stallId, idempotencyKey },
    }),
    prisma.domainOutboxEvent.deleteMany({
      where: { organizationId, stallId, aggregateId: { in: orderIds } },
    }),
    prisma.domainInboxMessage.deleteMany({
      where: {
        organizationId,
        stallId,
        source: "OFFLINE_ORDER_SYNC",
        messageKey: idempotencyKey,
      },
    }),
    prisma.usageEvent.deleteMany({
      where: { organizationId, stallId, referenceId: { in: orderIds } },
    }),
    prisma.auditLog.deleteMany({
      where: { organizationId, stallId, entityId: { in: orderIds } },
    }),
    prisma.order.deleteMany({
      where: { organizationId, stallId, id: { in: orderIds } },
    }),
  ]);
}

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
  if (deviceIds.length > 0) {
    await prisma.$transaction([
      prisma.offlineSyncConflict.deleteMany({
        where: { organizationId, stallId, deviceId: { in: deviceIds } },
      }),
      prisma.offlinePermit.deleteMany({
        where: { organizationId, stallId, deviceId: { in: deviceIds } },
      }),
    ]);
  }
  await prisma.offlineStallRuntimePolicy.deleteMany({ where: { organizationId, stallId } });
  if (deviceIds.length > 0) {
    await prisma.clientDevice.deleteMany({ where: { id: { in: deviceIds } } });
  }
  const snapshots = await prisma.menuSnapshot.findMany({
    where: { organizationId, stallId },
    select: { id: true, publicObjectPath: true },
  });
  if (snapshots.length > 0) {
    await removeLocalSnapshotObjects(
      snapshots.map((snapshot) => snapshot.publicObjectPath),
    );
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

async function removeLocalSnapshotObjects(objectPaths: string[]) {
  const url = process.env.PRIMARY_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.PRIMARY_SUPABASE_SECRET_KEY
    ?? process.env.PRIMARY_SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("本機 Storage 清理設定不完整");
  const hostname = new URL(url).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕清理非本機 Storage：${hostname}`);
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.storage.from("offline-menu-snapshots").remove(objectPaths);
  if (result.error) throw new Error("本機離線快照清理失敗");
}

async function login(page: Page, email: string, expectedUrl: RegExp) {
  await gotoLocalPath(page, "/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
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
