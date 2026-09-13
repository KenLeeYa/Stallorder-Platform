import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export type FieldScope = { organizationId: string; recordId: string; field: string };
function keyBytes(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("COMPLIANCE_KEY_REQUIRED");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error("COMPLIANCE_KEY_REQUIRED");
  return bytes;
}
function fieldKey(environment: Record<string, string | undefined>, keyId?: string) {
  if (!keyId) return keyBytes(environment.COMPLIANCE_FIELD_KEY);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId)) throw new Error("COMPLIANCE_KEY_REQUIRED");
  try {
    const keys = JSON.parse(environment.COMPLIANCE_FIELD_KEYS ?? "{}");
    if (!Object.hasOwn(keys, keyId)) throw new Error();
    return keyBytes(keys[keyId]);
  } catch { throw new Error("COMPLIANCE_KEY_REQUIRED"); }
}
function aad(scope: FieldScope) { return Buffer.from(JSON.stringify(["compliance-v1", scope.organizationId, scope.recordId, scope.field])); }
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function subjectDigest(value: string, organizationId: string, environment: Record<string, string | undefined> = process.env) {
  // Index/receipt identity must remain stable when the encryption writer rotates.
  const valueKey = environment.COMPLIANCE_SUBJECT_KEY
    ?? (!environment.COMPLIANCE_ACTIVE_KEY_ID ? environment.COMPLIANCE_FIELD_KEY : undefined);
  return createHmac("sha256", keyBytes(valueKey)).update(JSON.stringify(["subject-v1", organizationId, value])).digest("hex");
}
export function seal(value: string, scope: FieldScope, environment: Record<string, string | undefined> = process.env) {
  const nonce = randomBytes(12);
  const keyId = environment.COMPLIANCE_ACTIVE_KEY_ID;
  if (keyId) keyBytes(environment.COMPLIANCE_SUBJECT_KEY);
  const cipher = createCipheriv("aes-256-gcm", fieldKey(environment, keyId), nonce);
  cipher.setAAD(aad(scope));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [...(keyId ? ["v2", keyId] : ["v1"]), nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function unseal(value: string, scope: FieldScope, environment: Record<string, string | undefined> = process.env) {
  const parts = value.split("."); const version = parts.shift();
  const keyId = version === "v2" ? parts.shift() : undefined;
  const [nonce, tag, encrypted, ...extra] = parts;
  if (!["v1", "v2"].includes(version ?? "") || (version === "v2" && !keyId)
    || !nonce || !tag || encrypted === undefined || extra.length) throw new Error("COMPLIANCE_CIPHERTEXT_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", fieldKey(environment, keyId), Buffer.from(nonce, "base64url"));
    decipher.setAAD(aad(scope)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("COMPLIANCE_CIPHERTEXT_INVALID"); }
}
