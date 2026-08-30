import { createHash } from "node:crypto";

export class DrBillingFeatureFlagConflictError extends Error {
  constructor(code) {
    super(code);
    this.name = "DrBillingFeatureFlagConflictError";
    this.code = code;
  }
}

export const einvoiceFeatureFlags = Object.freeze([
  ["EINVOICE_AUTO_ALLOWANCE_ENABLED", false, 3, "依核准政策自動折讓。"],
  ["EINVOICE_AUTO_ISSUE_ENABLED", false, 2, "依政策自動開立。"],
  ["EINVOICE_AUTO_VOID_ENABLED", false, 3, "依核准政策自動作廢。"],
  ["EINVOICE_CARRIER_ENABLED", false, 2, "顧客載具欄位。"],
  ["EINVOICE_CHECKOUT_UI_ENABLED", false, 2, "顧客結帳電子發票選擇器。"],
  ["EINVOICE_DONATION_ENABLED", false, 2, "顧客捐贈碼欄位。"],
  ["EINVOICE_ECPAY_ENABLED", false, 2, "ECPay 電子發票 Adapter。"],
  ["EINVOICE_EZPAY_ENABLED", false, 2, "ezPay 電子發票 Adapter。"],
  ["EINVOICE_MERCHANT_SETUP_ENABLED", false, 2, "允許商家準備電子發票設定；需在本機環境明確啟用。"],
  ["EINVOICE_PLATFORM_ENABLED", false, 2, "店家自有帳號電子發票平台總開關。"],
  ["EINVOICE_PRODUCTION_ISSUE_ENABLED", false, 2, "正式電子發票開立。"],
  ["EINVOICE_SANDBOX_ENABLED", false, 2, "外部供應商 Sandbox 呼叫。"],
  ["EINVOICE_TRADEVAN_ENABLED", false, 3, "TradeVan 電子發票 Adapter。"],
].map(([code, isEnabled, phase, description]) => Object.freeze({
  code,
  isEnabled,
  phase,
  description,
})));

export const einvoiceFeatureFlagCodes = Object.freeze(
  einvoiceFeatureFlags.map((flag) => flag.code),
);

export function buildRepairPlan({ primaryRows, drRows }) {
  const primary = assertExpectedRows(primaryRows, "PRIMARY");
  const dr = assertExpectedRows(drRows, "DR");
  const primaryBusinessDigest = businessDigest(primary);
  const drBusinessDigest = businessDigest(dr);
  if (primaryBusinessDigest !== drBusinessDigest) {
    throw new DrBillingFeatureFlagConflictError("FEATURE_FLAG_BUSINESS_STATE_MISMATCH");
  }

  const primaryRowDigest = rowDigest(primary);
  const drRowDigest = rowDigest(dr);
  if (primaryRowDigest === drRowDigest) {
    throw new DrBillingFeatureFlagConflictError("FEATURE_FLAG_ROWS_ALREADY_SYNCHRONIZED");
  }

  return {
    table: "public.billing_feature_flags",
    constraint: "billing_feature_flags_pkey",
    conflictCode: "23505",
    rowCount: einvoiceFeatureFlags.length,
    keys: einvoiceFeatureFlagCodes,
    primaryBusinessDigest,
    drBusinessDigest,
    primaryRowDigest,
    drRowDigest,
    businessRowsEquivalent: true,
  };
}

export function verifyRepair({ primaryRows, drRows }) {
  const primary = assertExpectedRows(primaryRows, "PRIMARY");
  const dr = assertExpectedRows(drRows, "DR");
  const primaryRowDigest = rowDigest(primary);
  const drRowDigest = rowDigest(dr);
  if (primaryRowDigest !== drRowDigest) {
    throw new DrBillingFeatureFlagConflictError("FEATURE_FLAG_REPAIR_NOT_REPLICATED");
  }
  return {
    rowCount: einvoiceFeatureFlags.length,
    keys: einvoiceFeatureFlagCodes,
    rowDigest: primaryRowDigest,
    rowsIdentical: true,
  };
}

export function normalizeRows(rows) {
  return [...rows]
    .map((row) => ({
      code: String(row.code),
      isEnabled: row.is_enabled === true,
      phase: Number(row.phase),
      description: String(row.description),
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function assertExpectedRows(rows, backend) {
  const normalized = normalizeRows(rows);
  if (normalized.length !== einvoiceFeatureFlags.length) {
    throw new DrBillingFeatureFlagConflictError(`${backend}_FEATURE_FLAG_COUNT_MISMATCH`);
  }
  for (let index = 0; index < einvoiceFeatureFlags.length; index += 1) {
    const actual = normalized[index];
    const expected = einvoiceFeatureFlags[index];
    if (
      actual.code !== expected.code
      || actual.isEnabled !== expected.isEnabled
      || actual.phase !== expected.phase
      || actual.description !== expected.description
    ) {
      throw new DrBillingFeatureFlagConflictError(`${backend}_FEATURE_FLAG_STATE_MISMATCH`);
    }
  }
  return normalized;
}

function businessDigest(rows) {
  return digest(rows.map(({ code, isEnabled, phase, description }) => ({
    code,
    isEnabled,
    phase,
    description,
  })));
}

function rowDigest(rows) {
  return digest(rows);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new DrBillingFeatureFlagConflictError("FEATURE_FLAG_TIMESTAMP_INVALID");
  }
  return date.toISOString();
}
