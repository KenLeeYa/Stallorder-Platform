import { describe, expect, it } from "vitest";
import {
  mobileBootstrapResponseSchema,
  mobileDashboardResponseSchema,
  mobileLoginRequestSchema,
  mobileLoginResponseSchema,
  mobileLocalLabActionRequestSchema,
  mobileLocalLabResponseSchema,
  mobileOrderListResponseSchema,
  mobileOrdersQuerySchema,
  mobileSessionRefreshResponseSchema,
} from "./index";

describe("mobile v1 contracts", () => {
  it("normalizes login Email and rejects client-supplied roles", () => {
    expect(mobileLoginRequestSchema.parse({
      email: " Owner@Example.Test ",
      password: "valid-password",
      deviceId: "11111111-1111-4111-8111-111111111111",
    }).email).toBe("owner@example.test");
    expect(mobileLoginRequestSchema.safeParse({
      email: "owner@example.test",
      password: "valid-password",
      deviceId: "11111111-1111-4111-8111-111111111111",
      role: "PLATFORM_ADMIN",
    }).success).toBe(false);
  });

  it("requires opaque session material and versioned bootstrap data", () => {
    expect(mobileLoginResponseSchema.safeParse({
      version: "v1",
      session: { token: "short", expiresAt: new Date().toISOString() },
    }).success).toBe(false);
    expect(mobileBootstrapResponseSchema.safeParse({ version: "v1" }).success).toBe(false);
    expect(mobileSessionRefreshResponseSchema.safeParse({
      version: "v1",
      session: { token: "not opaque", expiresAt: new Date().toISOString() },
    }).success).toBe(false);
  });

  it("bounds order filters and rejects unversioned operational responses", () => {
    expect(mobileOrdersQuerySchema.safeParse({
      statuses: ["READY", "READY"],
      limit: 30,
    }).success).toBe(false);
    expect(mobileOrdersQuerySchema.safeParse({
      statuses: ["WAITING_CONFIRMATION", "READY"],
      query: "A-100",
      limit: 30,
    }).success).toBe(true);
    expect(mobileOrderListResponseSchema.safeParse({ stallId: crypto.randomUUID() }).success).toBe(false);
    expect(mobileDashboardResponseSchema.safeParse({ version: "v1" }).success).toBe(false);
  });

  it("strictly validates Local capability-lab actions and snapshots", () => {
    expect(mobileLocalLabActionRequestSchema.safeParse({
      action: "POS_CHECKOUT",
      targetId: "local-pos-cart",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      role: "PLATFORM_ADMIN",
    }).success).toBe(false);
    expect(mobileLocalLabResponseSchema.safeParse({
      version: "v1",
      mode: "LOCAL_FIXTURE",
      persona: "MERCHANT",
      generatedAt: new Date().toISOString(),
      notice: "僅供本機測試。",
      sections: [{
        id: "MERCHANT_ORDERS_POS",
        title: "訂單與 POS",
        description: "本機展示",
        items: [{
          id: "local-order",
          title: "測試訂單",
          subtitle: "只使用合成資料",
          status: "待確認",
          value: "NT$285",
          tone: "WARNING",
          action: { type: "ORDER_ADVANCE", label: "接單", confirm: true },
        }],
      }],
    }).success).toBe(true);
  });
});
