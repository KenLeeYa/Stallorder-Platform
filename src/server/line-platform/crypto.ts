import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function dataKey() {
  const key = Buffer.from(process.env.LINE_PLATFORM_DATA_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("LINE_PLATFORM_DATA_KEY_REQUIRED");
  return key;
}

export function hashPlatformSubject(environment: string, providerId: string, subject: string) {
  return createHash("sha256").update(JSON.stringify([environment, providerId, subject])).digest("hex");
}

export function encryptPlatformValue(value: string, purpose = "platform-value-v1") {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptPlatformValue(value: string, purpose = "platform-value-v1") {
  const [version, iv, tag, encrypted, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra) throw new Error("LINE_PLATFORM_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
