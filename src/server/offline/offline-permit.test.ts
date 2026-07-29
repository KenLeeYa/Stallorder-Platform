import { describe, expect, it } from "vitest";
import {
  signOfflinePermit,
  verifyOfflinePermit,
  type OfflinePermitPayload,
} from "@/server/offline/offline-permit";
import { OFFLINE_APP_PROTOCOL_VERSION } from "@/offline/offline-contract";

const secret = "test-only-offline-permit-secret-with-32-bytes";

function payload(overrides: Partial<OfflinePermitPayload> = {}): OfflinePermitPayload {
  return {
    permitId: "10000000-0000-4000-8000-000000000001",
    deviceId: "20000000-0000-4000-8000-000000000001",
    profileId: "30000000-0000-4000-8000-000000000001",
    organizationId: "40000000-0000-4000-8000-000000000001",
    stallId: "50000000-0000-4000-8000-000000000001",
    roles: ["STAFF"],
    allowedOfflineActions: ["CREATE_OFFLINE_ORDER", "RECORD_CASH_PAYMENT"],
    issuedAt: "2026-07-29T00:00:00.000Z",
    expiresAt: "2026-07-29T08:00:00.000Z",
    menuSnapshotVersion: 3,
    promotionEpoch: "2",
    appProtocolVersion: OFFLINE_APP_PROTOCOL_VERSION,
    storageClass: "PERSISTENT",
    riskLimits: {
      maxOfflineDurationMinutes: 480,
      maxPendingOrders: 25,
      maxTotalAmount: 10000,
      maxSingleOrderAmount: 2000,
      maxManualPaymentAmount: 1000,
      maxTotalManualPaymentAmount: 3000,
      requireCustomerContactAboveAmount: 1000,
      managerApprovalThreshold: 1000,
    },
    ...overrides,
  };
}

describe("offline Permit", () => {
  it("signs and verifies a bounded device-scoped Permit", () => {
    const token = signOfflinePermit(payload(), secret);
    expect(verifyOfflinePermit(token, secret, new Date("2026-07-29T01:00:00.000Z"))).toEqual(payload());
  });

  it("rejects forged and expired tokens", () => {
    const token = signOfflinePermit(payload(), secret);
    expect(verifyOfflinePermit(`${token}forged`, secret, new Date("2026-07-29T01:00:00.000Z"))).toBeNull();
    expect(verifyOfflinePermit(token, secret, new Date("2026-07-29T08:00:00.000Z"))).toBeNull();
  });

  it("rejects Permit lifetimes over twelve hours", () => {
    expect(() => signOfflinePermit(payload({
      expiresAt: "2026-07-29T12:00:00.001Z",
    }), secret)).toThrow();
  });

  it("requires a signing secret with sufficient entropy", () => {
    expect(() => signOfflinePermit(payload(), "too-short")).toThrow(
      "OFFLINE_PERMIT_SIGNING_SECRET_INVALID",
    );
  });
});
