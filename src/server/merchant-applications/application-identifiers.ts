import "server-only";

import { createHmac } from "node:crypto";

const DEVELOPMENT_HASH_SECRET = "stallorder-merchant-application-development-secret";

export function normalizeApplicationPhone(value: string) {
  const normalized = value.trim().replace(/[\s().-]/g, "");
  return normalized.startsWith("+")
    ? `+${normalized.slice(1).replace(/\D/g, "")}`
    : normalized.replace(/\D/g, "");
}

export function normalizeRegistrationNumber(value: string | null) {
  const normalized = value?.trim().toUpperCase().replace(/[\s-]/g, "") ?? "";
  return normalized || null;
}

export function hashApplicationIdentifier(kind: "email" | "phone" | "registration", value: string) {
  const secret = process.env.AUDIT_IP_HASH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("正式環境必須設定 AUDIT_IP_HASH_SECRET。");
  }
  return createHmac("sha256", secret || DEVELOPMENT_HASH_SECRET)
    .update(`merchant-application:${kind}:${value}`)
    .digest("hex");
}
