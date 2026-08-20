import { createHash, randomBytes } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const existingClientHashPattern = /^[A-Za-z0-9_-]{32,128}$/u;
const capabilityPattern = /^[A-Za-z0-9_-]{16,200}$/u;

export const STATIC_QR_RECOVERY_CONTRACT = {
  kind: "STATIC_QR_RECOVERY",
  safe: true,
  staticQrRemainsValid: true,
  messageCode: "SCAN_PRINTED_STATIC_QR",
} as const;

export type DynamicQrIssueCommand = {
  organizationId: string;
  stallId: string;
  diningTableId: string;
  staticQrCodeId: string;
  orderSessionId: string;
  tokenHash: string;
  nonceHash: string;
  deviceHash: string;
  ipHash: string;
  requestId: string;
};

export type DynamicQrRedeemCommand = {
  tokenHash: string;
  nonceHash: string;
  staticQrToken: string;
  deviceHash: string;
  ipHash: string;
  requestId: string;
};

type DynamicQrRpcFailure = {
  ok: false;
  code?: string;
  fallback?: Record<string, unknown> & { reason_code?: string };
};

type DynamicQrIssueRpcSuccess = {
  ok: true;
  code: "DYNAMIC_QR_ISSUED";
  credential_id: string;
  credential_version: number;
  max_redemptions: number;
  expires_at: string;
};

type DynamicQrRedeemRpcSuccess = {
  ok: true;
  code: "DYNAMIC_QR_REDEEMED";
  credential_id: string;
  order_session_id: string;
  remaining_redemptions: number;
  canonical_preflight: Record<string, unknown>;
};

export interface DynamicQrRepository {
  issue(input: DynamicQrIssueCommand): Promise<DynamicQrIssueRpcSuccess | DynamicQrRpcFailure | null>;
  redeem(input: DynamicQrRedeemCommand): Promise<DynamicQrRedeemRpcSuccess | DynamicQrRpcFailure | null>;
}

type IssueInput = Omit<DynamicQrIssueCommand, "tokenHash" | "nonceHash">;

type RedeemInput = Omit<DynamicQrRedeemCommand, "tokenHash" | "nonceHash"> & {
  credentialToken: string;
  nonce: string;
};

type ServiceDependencies = {
  repository: DynamicQrRepository;
};

type IssueDependencies = ServiceDependencies & {
  generateCapability?: () => { credentialToken: string; nonce: string };
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function defaultCapability() {
  return {
    credentialToken: `dqr_${randomBytes(32).toString("base64url")}`,
    nonce: `dqn_${randomBytes(24).toString("base64url")}`,
  };
}

function fallback(code: string) {
  return {
    ok: false as const,
    code,
    fallback: {
      ...STATIC_QR_RECOVERY_CONTRACT,
      reasonCode: code,
    },
  };
}

function validExistingClientHash(value: string) {
  return existingClientHashPattern.test(value);
}

function validRequestId(value: string) {
  return value.length >= 1 && value.length <= 100;
}

function validIssueInput(input: IssueInput) {
  return uuidPattern.test(input.organizationId)
    && uuidPattern.test(input.stallId)
    && uuidPattern.test(input.diningTableId)
    && uuidPattern.test(input.staticQrCodeId)
    && uuidPattern.test(input.orderSessionId)
    && validExistingClientHash(input.deviceHash)
    && validExistingClientHash(input.ipHash)
    && validRequestId(input.requestId);
}

function validRedeemInput(input: RedeemInput) {
  return capabilityPattern.test(input.credentialToken)
    && capabilityPattern.test(input.nonce)
    && input.staticQrToken.length >= 24
    && input.staticQrToken.length <= 200
    && validExistingClientHash(input.deviceHash)
    && validExistingClientHash(input.ipHash)
    && validRequestId(input.requestId);
}

export async function issueDynamicQrCredential(
  input: IssueInput,
  dependencies: IssueDependencies,
) {
  if (!validIssueInput(input)) return fallback("DYNAMIC_QR_INVALID");
  const capability = (dependencies.generateCapability ?? defaultCapability)();
  if (
    !capabilityPattern.test(capability.credentialToken)
    || !capabilityPattern.test(capability.nonce)
  ) {
    return fallback("DYNAMIC_QR_UNAVAILABLE");
  }

  try {
    const result = await dependencies.repository.issue({
      ...input,
      tokenHash: sha256(capability.credentialToken),
      nonceHash: sha256(capability.nonce),
    });
    if (!result?.ok) return fallback(result?.code ?? "DYNAMIC_QR_UNAVAILABLE");
    return {
      ok: true as const,
      code: result.code,
      credentialId: result.credential_id,
      credentialVersion: result.credential_version,
      maxRedemptions: result.max_redemptions,
      expiresAt: result.expires_at,
      credentialToken: capability.credentialToken,
      nonce: capability.nonce,
    };
  } catch {
    return fallback("DYNAMIC_QR_UNAVAILABLE");
  }
}

export async function redeemDynamicQrCredential(
  input: RedeemInput,
  dependencies: ServiceDependencies,
) {
  if (!validRedeemInput(input)) return fallback("DYNAMIC_QR_INVALID");

  try {
    const result = await dependencies.repository.redeem({
      tokenHash: sha256(input.credentialToken),
      nonceHash: sha256(input.nonce),
      staticQrToken: input.staticQrToken,
      deviceHash: input.deviceHash,
      ipHash: input.ipHash,
      requestId: input.requestId,
    });
    if (!result?.ok) return fallback(result?.code ?? "DYNAMIC_QR_UNAVAILABLE");
    return {
      ok: true as const,
      code: result.code,
      credentialId: result.credential_id,
      orderSessionId: result.order_session_id,
      remainingRedemptions: result.remaining_redemptions,
      canonicalPreflight: result.canonical_preflight,
    };
  } catch {
    return fallback("DYNAMIC_QR_UNAVAILABLE");
  }
}
