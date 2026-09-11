import { createCipheriv, createDecipheriv, createECDH, createHash, createHmac, ECDH, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function allowedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (!url.port || url.port === "443")
      && !url.username && !url.password && !url.hash
      && (url.hostname === "fcm.googleapis.com"
        || url.hostname.endsWith(".push.apple.com")
        || url.hostname === "updates.push.services.mozilla.com");
  } catch { return false; }
}
const key = (bytes: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).refine(value => Buffer.from(value, "base64url").length === bytes);
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(allowedPushEndpoint),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    auth: key(16),
    p256dh: key(65).refine(value => {
      try { ECDH.convertKey(Buffer.from(value, "base64url"), "prime256v1"); return true; } catch { return false; }
    }),
  }).strict(),
}).strict();

export function pushConfig(env: Record<string, string | undefined> = process.env) {
  if (env.WEB_PUSH_ENABLED !== "true") return null;
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "";
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "";
  const encryptionKey = env.WEB_PUSH_ENCRYPTION_KEY ?? "";
  const subject = env.WEB_PUSH_VAPID_SUBJECT ?? "";
  if (Buffer.from(publicKey, "base64url").length !== 65
    || Buffer.from(privateKey, "base64url").length !== 32
    || Buffer.from(encryptionKey, "base64").length !== 32
    || !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) return null;
  try {
    const ec = createECDH("prime256v1");
    ec.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (ec.getPublicKey().toString("base64url") !== publicKey) return null;
  } catch { return null; }
  return { publicKey, privateKey, encryptionKey, subject };
}
export function pushHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function encryptSubscription(value: unknown, encryptionKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
export function decryptSubscription(value: string, encryptionKey: string) {
  const input = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(encryptionKey, "base64"), input.subarray(0, 12));
  cipher.setAuthTag(input.subarray(12, 28));
  return pushSubscriptionSchema.parse(JSON.parse(Buffer.concat([cipher.update(input.subarray(28)), cipher.final()]).toString()));
}
export function pushReceiptToken(id: string, encryptionKey: string) {
  return createHmac("sha256", Buffer.from(encryptionKey, "base64")).update("staff-push-displayed:" + id).digest("base64url");
}
export function validPushReceipt(id: string, token: string, encryptionKey: string) {
  const expected = Buffer.from(pushReceiptToken(id, encryptionKey));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
