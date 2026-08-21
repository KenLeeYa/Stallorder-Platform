import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueDynamicQrCredential,
  redeemDynamicQrCredential,
  STATIC_QR_RECOVERY_CONTRACT,
  type DynamicQrRepository,
} from "./credential-service";

const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  stallId: "22222222-2222-4222-8222-222222222222",
  diningTableId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  staticQrCodeId: "33333333-3333-4333-8333-333333333334",
  orderSessionId: "44444444-4444-4444-8444-444444444444",
  deviceHash: "d".repeat(64),
  ipHash: "i".repeat(64),
  requestId: "dynamic-qr-test-request",
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("dynamic QR credential service", () => {
  let repository: DynamicQrRepository;

  beforeEach(() => {
    repository = {
      issue: vi.fn().mockResolvedValue({
        ok: true,
        code: "DYNAMIC_QR_ISSUED",
        credential_id: "55555555-5555-4555-8555-555555555555",
        credential_version: 3,
        max_redemptions: 1,
        expires_at: "2026-08-13T02:10:00.000Z",
      }),
      redeem: vi.fn().mockResolvedValue({
        ok: true,
        code: "DYNAMIC_QR_REDEEMED",
        credential_id: "55555555-5555-4555-8555-555555555555",
        order_session_id: scope.orderSessionId,
        remaining_redemptions: 0,
        canonical_preflight: { ok: true, scope: "ORDER" },
      }),
    };
  });

  it("returns raw capability material once while sending only hashes to storage", async () => {
    const credentialToken = "dynamic-secret-token";
    const nonce = "dynamic-secret-nonce";
    const result = await issueDynamicQrCredential(scope, {
      repository,
      generateCapability: () => ({ credentialToken, nonce }),
    });

    expect(result).toMatchObject({
      ok: true,
      credentialToken,
      nonce,
      credentialVersion: 3,
      maxRedemptions: 1,
    });
    expect(repository.issue).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: sha256(credentialToken),
      nonceHash: sha256(nonce),
    }));
    const storedPayload = JSON.stringify(vi.mocked(repository.issue).mock.calls[0]?.[0]);
    expect(storedPayload).not.toContain(credentialToken);
    expect(storedPayload).not.toContain(nonce);
  });

  it("hashes the dynamic capability before redemption and retains static QR recovery", async () => {
    const result = await redeemDynamicQrCredential({
      credentialToken: "dynamic-redeem-token",
      nonce: "dynamic-redeem-nonce",
      staticQrToken: "demo-aming-chicken-table-a1-qr-2026",
      deviceHash: scope.deviceHash,
      ipHash: scope.ipHash,
      requestId: scope.requestId,
    }, { repository });

    expect(repository.redeem).toHaveBeenCalledWith({
      tokenHash: sha256("dynamic-redeem-token"),
      nonceHash: sha256("dynamic-redeem-nonce"),
      staticQrToken: "demo-aming-chicken-table-a1-qr-2026",
      deviceHash: scope.deviceHash,
      ipHash: scope.ipHash,
      requestId: scope.requestId,
    });
    expect(result).toMatchObject({
      ok: true,
      code: "DYNAMIC_QR_REDEEMED",
      canonicalPreflight: { ok: true, scope: "ORDER" },
    });
    expect(result).not.toHaveProperty("credentialToken");
    expect(result).not.toHaveProperty("nonce");
  });

  it("converts credential denial into a safe printed-static-QR fallback", async () => {
    vi.mocked(repository.redeem).mockResolvedValue({
      ok: false,
      code: "DYNAMIC_QR_DEVICE_MISMATCH",
      fallback: {
        ...STATIC_QR_RECOVERY_CONTRACT,
        reason_code: "DYNAMIC_QR_DEVICE_MISMATCH",
      },
    });

    const result = await redeemDynamicQrCredential({
      credentialToken: "shared-screenshot-token",
      nonce: "shared-screenshot-nonce",
      staticQrToken: "demo-aming-chicken-table-a1-qr-2026",
      deviceHash: "e".repeat(64),
      ipHash: scope.ipHash,
      requestId: scope.requestId,
    }, { repository });

    expect(result).toEqual({
      ok: false,
      code: "DYNAMIC_QR_DEVICE_MISMATCH",
      fallback: {
        ...STATIC_QR_RECOVERY_CONTRACT,
        reasonCode: "DYNAMIC_QR_DEVICE_MISMATCH",
      },
    });
  });

  it("fails closed to the same static contract on malformed input or storage failure", async () => {
    const malformed = await redeemDynamicQrCredential({
      credentialToken: "",
      nonce: "",
      staticQrToken: "",
      deviceHash: "not-a-hash",
      ipHash: scope.ipHash,
      requestId: scope.requestId,
    }, { repository });
    expect(malformed).toEqual({
      ok: false,
      code: "DYNAMIC_QR_INVALID",
      fallback: {
        ...STATIC_QR_RECOVERY_CONTRACT,
        reasonCode: "DYNAMIC_QR_INVALID",
      },
    });
    expect(repository.redeem).not.toHaveBeenCalled();

    vi.mocked(repository.redeem).mockRejectedValue(new Error("database unavailable"));
    const unavailable = await redeemDynamicQrCredential({
      credentialToken: "valid-looking-token",
      nonce: "valid-looking-nonce",
      staticQrToken: "demo-aming-chicken-table-a1-qr-2026",
      deviceHash: scope.deviceHash,
      ipHash: scope.ipHash,
      requestId: scope.requestId,
    }, { repository });
    expect(unavailable).toEqual({
      ok: false,
      code: "DYNAMIC_QR_UNAVAILABLE",
      fallback: {
        ...STATIC_QR_RECOVERY_CONTRACT,
        reasonCode: "DYNAMIC_QR_UNAVAILABLE",
      },
    });
  });
});
