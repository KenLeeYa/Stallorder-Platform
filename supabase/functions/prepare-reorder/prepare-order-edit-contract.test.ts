import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("prepare public order edit contract", () => {
  it("uses order-edit safety gates without the LINE repeat-order entitlement", () => {
    expect(source).not.toContain("LINE_REPEAT_ORDER");
    expect(source).toContain('context.order.status !== "WAITING_CONFIRMATION"');
    expect(source).toContain('context.order.status !== "CONFIRMED"');
    expect(source).toContain('context.admin.rpc("reorder_print_job_started"');
    expect(source).toContain("printQuery.data === true");
    expect(source).not.toContain('.from("print_jobs")');
    expect(source).toContain('task.status !== "PENDING"');
  });

  it("returns the original customer draft and preserves the ordering entry path", () => {
    expect(source).toContain('.select("code")');
    expect(source).toContain('.from("order_sessions")');
    expect(source).toContain('.select("ordering_mode")');
    expect(source).toContain('orderingMode === "DEFAULT"');
    expect(source).toContain('`/q/${encodeURIComponent(qrCode.token)}`');
    expect(source).toContain("/store/${encodeURIComponent(stallQuery.data.code)}?view=${view}");
    expect(source).toContain("customerName: context.order.customer_name");
    expect(source).toContain("customerPhone: context.order.customer_phone");
    expect(source).toContain("scheduledPickupAt: context.order.requested_fulfillment_at");
  });
});
