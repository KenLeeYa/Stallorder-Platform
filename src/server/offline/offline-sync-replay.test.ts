import { describe, expect, it } from "vitest";
import { hashToken } from "@/lib/security";
import {
  matchesExistingOrderReplay,
  rejectedInboxReplayErrorCode,
} from "@/server/offline/offline-sync-replay";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const actorProfileId = "44444444-4444-4444-8444-444444444444";
const offlineOrderId = "55555555-5555-4555-8555-555555555555";
const idempotencyKey = "66666666-6666-4666-8666-666666666666";

function matches(overrides: Partial<Parameters<typeof matchesExistingOrderReplay>[0]["existing"]> = {}) {
  return matchesExistingOrderReplay({
    organizationId,
    stallId,
    deviceId,
    actorProfileId,
    offlineOrderId,
    idempotencyKey,
    existing: {
      organizationId,
      stallId,
      source: "STAFF_POS",
      origin: "ONLINE_STAFF",
      deviceHash: hashToken(`staff-order:${actorProfileId}:STAFF_POS`),
      sourceDeviceId: null,
      offlineOrderId: null,
      idempotencyKey,
      ...overrides,
    },
  });
}

describe("offline synchronization replay identity", () => {
  it("reconciles an online Staff POS write whose success response was lost", () => {
    expect(matches()).toBe(true);
  });

  it("reconciles a previously imported offline order from the same device", () => {
    expect(matches({
      source: "STAFF_POS_OFFLINE_SYNC",
      origin: "OFFLINE_POS",
      deviceHash: "server-generated-device-hash",
      sourceDeviceId: deviceId,
      offlineOrderId,
    })).toBe(true);
  });

  it("rejects another actor, tenant, source or idempotency identity", () => {
    expect(matches({
      deviceHash: hashToken("staff-order:another-profile:STAFF_POS"),
    })).toBe(false);
    expect(matches({ organizationId: "77777777-7777-4777-8777-777777777777" })).toBe(false);
    expect(matches({ source: "QR_MENU", origin: "ONLINE_QR" })).toBe(false);
    expect(matches({ idempotencyKey: "88888888-8888-4888-8888-888888888888" })).toBe(false);
  });

  it("keeps rejected order and cash inbox replays rejected", () => {
    expect(rejectedInboxReplayErrorCode(
      "REJECTED",
      { outcome: "REJECTED", errorCode: "OFFLINE_CASH_SHIFT_ALREADY_CLOSED" },
    )).toBe("OFFLINE_CASH_SHIFT_ALREADY_CLOSED");
    expect(rejectedInboxReplayErrorCode(
      "REJECTED",
      { errorCode: "unsafe value" },
    )).toBe("OFFLINE_SYNC_REJECTED");
    expect(rejectedInboxReplayErrorCode(
      "PROCESSED",
      { outcome: "ACCEPTED" },
    )).toBeNull();
  });
});
