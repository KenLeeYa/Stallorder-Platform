import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isInvoiceDevMode } from "./runtime-policy";

const sensitiveName = /(hashkey|hashiv|api.?key|secret|token|certificate.?pin|carrier.?value|encrypted.?payload)/i;

export function sanitizeInvoiceErrorMessage(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.replace(/[^A-Z0-9_.:-]/gi, "_").slice(0, 180) || "INVOICE_PROVIDER_ERROR";
}

export function redactInvoiceSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactInvoiceSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveName.test(key) ? "[REDACTED]" : redactInvoiceSecrets(item),
  ]));
}

export function hashInvoiceRequest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function encryptInvoiceSensitiveValue(value: string, environment: NodeJS.ProcessEnv = process.env) {
  const effectiveKey = invoiceFieldEncryptionKey(environment);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", effectiveKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptInvoiceSensitiveValue(value: string, environment: NodeJS.ProcessEnv = process.env) {
  const [version, nonceValue, tagValue, ciphertextValue, ...extra] = value.split(".");
  if (version !== "v1" || !nonceValue || !tagValue || ciphertextValue === undefined || extra.length > 0) {
    throw new Error("EINVOICE_ENCRYPTED_VALUE_INVALID");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      invoiceFieldEncryptionKey(environment),
      Buffer.from(nonceValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("EINVOICE_ENCRYPTED_VALUE_INVALID");
  }
}

function invoiceFieldEncryptionKey(environment: NodeJS.ProcessEnv) {
  const configured = environment.EINVOICE_FIELD_ENCRYPTION_KEY?.trim();
  const key = configured ? Buffer.from(configured, "base64") : null;
  if ((!key || key.length !== 32) && !isInvoiceDevMode(environment)) {
    throw new Error("EINVOICE_FIELD_ENCRYPTION_KEY_REQUIRED");
  }
  return key && key.length === 32
    ? key
    : createHash("sha256").update("stallorder-local-einvoice-test-only", "utf8").digest();
}
