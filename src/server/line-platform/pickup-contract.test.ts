import { describe, expect, it } from "vitest";
import {
  createPickupSecrets, pickupDeadline, pickupLookupSchema, pickupRedeemSchema,
} from "./pickup-contract";

describe("platform pickup credential boundary", () => {
  it("issues independent opaque pickup and image capabilities with distinct purposes", () => {
    const first = createPickupSecrets();
    const second = createPickupSecrets();
    expect(first.token).toMatch(/^qidaigo:pickup:v1:[A-Za-z0-9_-]{43}$/);
    expect(first.mediaToken).toMatch(/^qpm1_[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.mediaToken).not.toBe(second.mediaToken);
    expect(pickupLookupSchema.safeParse({ kind: "QR", token: first.mediaToken }).success).toBe(false);
    expect(pickupLookupSchema.safeParse({ kind: "QR", token: first.token }).success).toBe(true);
  });
  it("keeps tomorrow's booking valid through its pickup grace period in UTC", () => {
    expect(pickupDeadline({ committedFulfillmentAt: null, scheduledPickupAt: new Date("2026-09-28T04:00:00Z"),
      requestedFulfillmentAt: null, createdAt: new Date("2026-09-27T00:00:00Z") }).toISOString()).toBe("2026-09-28T06:00:00.000Z");
  });
  it("requires explicit handoff confirmation, a version and idempotency key", () => {
    const input = { credential: { kind: "QR", token: createPickupSecrets().token }, expectedVersion: 1,
      idempotencyKey: "e62f42a7-9d91-41d8-ae0b-dbb7b1ee011f", confirmedHandoff: true };
    expect(pickupRedeemSchema.safeParse(input).success).toBe(true);
    expect(pickupRedeemSchema.safeParse({ ...input, confirmedHandoff: false }).success).toBe(false);
    expect(pickupRedeemSchema.safeParse({ ...input, expectedVersion: 0 }).success).toBe(false);
    expect(pickupRedeemSchema.safeParse({ ...input, role: "ADMIN" }).success).toBe(false);
  });
  it("does not accept a manual short code without a checked order and reason", () => {
    expect(pickupLookupSchema.safeParse({ kind: "MANUAL", code: "123" }).success).toBe(false);
    expect(pickupLookupSchema.safeParse({ kind: "MANUAL", orderId: "e62f42a7-9d91-41d8-ae0b-dbb7b1ee011f", code: "123",
      reason: "DEVICE_LOST", confirmedCustomerDetails: true }).success).toBe(true);
  });
});
