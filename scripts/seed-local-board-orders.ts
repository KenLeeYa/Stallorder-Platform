import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { request as playwrightRequest } from "@playwright/test";
import type { OrderStatus } from "@prisma/client";

// Explicitly scoped to the owner's isolated catalogue lab; never seed a hosted DB.
loadEnvFile(".env.local");
loadEnvFile("supabase/functions/e2e-runtime.defaults");
for (const [value, port] of [[process.env.DATABASE_URL, "55722"], [process.env.NEXT_PUBLIC_SUPABASE_URL, "55721"]]) {
  const url = new URL(value ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== port) throw new Error("DEDICATED_LOCAL_BOARD_LAB_REQUIRED");
}
const appUrl = "http://127.0.0.1:3018";
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const batch = "CATALOG-BOARD-10-20260907";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { createStaffOrder } = await import("../src/lib/staff-order-create");
  const api = await playwrightRequest.newContext({ baseURL: appUrl });
  try {
    const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId } });
    if (!settings.kdsModuleEnabled || !settings.dineInEnabled) throw new Error("LOCAL_KDS_AND_DINE_IN_MUST_BE_ENABLED");
    const actor = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
    const tables = await prisma.diningTable.findMany({ where: { stallId, isActive: true }, orderBy: { label: "asc" } });
    if (!tables.length) throw new Error("LOCAL_DINING_TABLE_REQUIRED");
    const products = await prisma.product.findMany({ where: { organizationId, isActive: true, kind: "SINGLE", stallProducts: { some: { stallId, isEnabled: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { noteGroupAssignments: { where: { isActive: true, noteGroup: { isActive: true } }, include: { noteGroup: { include: { options: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } } } } } },
    });
    if (products.length < 7) throw new Error("LOCAL_DEMO_CATALOG_REQUIRED");
    const login = await api.post("/api/auth/login", { headers: { origin: appUrl }, data: { email: "owner@stallorder.test", password: "StallOrderDemo!2026" } });
    if (!login.ok()) throw new Error(`LOCAL_LOGIN_${login.status()}`);
    const cookies = (await api.storageState()).cookies;
    const headers = { origin: appUrl, "x-csrf-token": cookies.find(row => row.name === "stallorder_csrf")?.value ?? "" };
    const cases: Array<{ status: OrderStatus; dineIn?: boolean; count: number; quantity?: number; note: string }> = [
      { status: "WAITING_CONFIRMATION", count: 1, note: "單品新單，請由店員確認" },
      { status: "WAITING_CONFIRMATION", dineIn: true, count: 2, note: "內用新單，確認桌號與客製註記" },
      { status: "WAITING_CONFIRMATION", count: 7, note: "多人外帶，請分開裝袋。此單用於長清單、上下捲動及多品項確認。" },
      { status: "CONFIRMED", dineIn: true, count: 3, note: "已確認，請由廚房開始製作" },
      { status: "CONFIRMED", count: 1, quantity: 4, note: "同品項多份數，核對數量與金額" },
      { status: "CONFIRMED", dineIn: true, count: 4, note: "跨分類餐點，核對不同工作站與註記" },
      { status: "PREPARING", count: 2, note: "製作中，請測試逐項完成" },
      { status: "PREPARING", dineIn: true, count: 5, note: "製作中長清單，請測試整單製作流程" },
      { status: "READY", count: 3, note: "多品項已製作完成，請核對後交付顧客" },
      { status: "READY", count: 2, note: "已可取餐，請由店員完成訂單" },
    ];
    async function patch(path: string, data: object) {
      const response = await api.patch(path, { headers, data });
      if (!response.ok()) {
        const body = await response.json();
        throw new Error(`LOCAL_ORDER_ACTION_${response.status()}: ${body.code ?? body.error ?? "FAILED"}`);
      }
    }
    const orderIds: string[] = [];
    for (const [index, fixture] of cases.entries()) {
      const result = await createStaffOrder({ organizationId, stallId, actorProfileId: actor.id, actorRoles: ["ORGANIZATION_OWNER"], creationMode: "SETUP_TEST",
        request: {
          idempotencyKey: `b7090010-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          customerName: `版面測試 ${String(index + 1).padStart(2, "0")}`,
          customerNote: `【本機測試 ${String(index + 1).padStart(2, "0")}】${fixture.note}`,
          customerPhone: "", paymentTiming: "PAY_LATER",
          ...(fixture.dineIn ? { fulfillmentType: "DINE_IN", diningTableId: tables[index % tables.length].id } as const : { fulfillmentType: "TAKEOUT", requestedFulfillmentAt: null } as const),
          items: Array.from({ length: fixture.count }, (_, itemIndex) => {
            const product = products[(index + itemIndex) % products.length];
            return { productId: product.id, quantity: fixture.quantity ?? (itemIndex % 3 === 0 ? 2 : 1),
              note: itemIndex === 0 ? "請依客製註記製作，餐點分開放。" : "", bundleChoiceIds: [],
              noteOptionIds: product.noteGroupAssignments.flatMap(({ noteGroup }) => {
                const count = Math.max(noteGroup.minSelections, noteGroup.isRequired ? 1 : 0, index % 2 === 0 ? 1 : 0);
                const ordered = [...noteGroup.options.slice(index % Math.max(1, noteGroup.options.length)), ...noteGroup.options.slice(0, index % Math.max(1, noteGroup.options.length))];
                return ordered.slice(0, count).map(option => option.id);
              }),
            };
          }),
        },
      });
      orderIds.push(result.order.id);
      // Reruns preserve the owner's subsequent edits/statuses instead of resetting their test work.
      if (result.idempotent) continue;
      if (fixture.status === "WAITING_CONFIRMATION") {
        await prisma.order.update({ where: { id: result.order.id }, data: { confirmationExpiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
      } else {
        await patch(`/api/stalls/aming-chicken/orders/${result.order.id}`, { status: "CONFIRMED" });
        if (fixture.status !== "CONFIRMED") {
          const tasks = await prisma.orderProductionTask.findMany({ where: { orderId: result.order.id } });
          if (!tasks.length) throw new Error("LOCAL_ORDER_HAS_NO_KITCHEN_TASKS");
          for (const task of tasks) {
            await patch("/api/stalls/aming-chicken/kitchen/tasks", { operation: "UPDATE_TASK", taskId: task.id, status: "PREPARING" });
            if (fixture.status === "READY") {
              await patch("/api/stalls/aming-chicken/kitchen/tasks", { operation: "UPDATE_TASK", taskId: task.id, status: "COMPLETED" });
            }
          }
          // Completing the final task already derives READY; a second completion is invalid.
          const updated = await prisma.order.findUniqueOrThrow({ where: { id: result.order.id }, select: { status: true } });
          if (updated.status !== fixture.status) throw new Error("LOCAL_SEED_STATUS_MISMATCH");
        }
      }
    }
    const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, orderBy: { orderNo: "asc" }, select: {
      id: true, orderNo: true, customerName: true, status: true, fulfillmentType: true, tableLabel: true, note: true, total: true, isTest: true,
      confirmationExpiresAt: true, items: { select: { name: true, quantity: true, note: true, noteOptions: { select: { groupName: true, optionName: true } } } },
      productionTasks: { select: { status: true } },
    } });
    if (orders.length !== 10 || orders.some(order => !order.isTest)) throw new Error("LOCAL_TEST_ORDER_COUNT_INVALID");
    const output = resolve("artifacts/local-board-orders-20260907.json");
    await mkdir(resolve("artifacts"), { recursive: true });
    await writeFile(output, JSON.stringify({ batch, createdAt: new Date().toISOString(), appUrl, orders }, null, 2));
    console.log(JSON.stringify({ batch, output, orders: orders.map(({ orderNo, status, fulfillmentType, tableLabel, isTest }) => ({ orderNo, status, fulfillmentType, tableLabel, isTest })) }, null, 2));
  } finally { await api.dispose(); await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "LOCAL_SEED_FAILED"); process.exitCode = 1; });
