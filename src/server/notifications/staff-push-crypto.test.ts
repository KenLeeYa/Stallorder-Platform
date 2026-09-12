import { describe, expect, it } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { allowedPushEndpoint, decryptSubscription, encryptSubscription, pushConfig, pushReceiptToken, pushSubscriptionSchema, validPushReceipt } from "./staff-push-crypto";

describe("staff push endpoint, encryption and receipts", () => {
  it.each([
    ["mailto:test@example.com", true], ["https://app.qidaigo.com", true],
    ["http://app.qidaigo.com", false], ["https://", false], ["invalid", false],
    ["mailto:invalid", false], ["https://user:password@app.qidaigo.com", false],
  ])("validates the VAPID contact URI: %s", (subject, accepted) => {
    const ec = createECDH("prime256v1"); ec.generateKeys();
    const config = pushConfig({ WEB_PUSH_ENABLED: "true", WEB_PUSH_VAPID_SUBJECT: subject,
      WEB_PUSH_VAPID_PUBLIC_KEY: ec.getPublicKey().toString("base64url"),
      WEB_PUSH_VAPID_PRIVATE_KEY: Buffer.from(ec.getPrivateKey().toString("hex").padStart(64, "0"), "hex").toString("base64url"),
      WEB_PUSH_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
    expect(config !== null).toBe(accepted);
  });
  it.each([
    "http://fcm.googleapis.com/send/id", "https://127.0.0.1/x", "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com/x", "https://fcm.googleapis.com:444/x", "https://user@fcm.googleapis.com/x",
    "https://fcm.googleapis.com/x#fragment", "file:///etc/passwd",
  ])("rejects untrusted endpoints: %s", value => expect(allowedPushEndpoint(value)).toBe(false));
  it.each(["https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc"])("accepts supported services: %s", value => expect(allowedPushEndpoint(value)).toBe(true));
  it("authenticates encrypted subscription data and rejects invalid EC keys", () => {
    const ec = createECDH("prime256v1"); ec.generateKeys();
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/qa", keys: { auth: randomBytes(16).toString("base64url"), p256dh: ec.getPublicKey().toString("base64url") } };
    const secret = randomBytes(32).toString("base64");
    const encrypted = encryptSubscription(sub, secret);
    expect(encrypted).not.toContain("googleapis");
    expect(decryptSubscription(encrypted, secret)).toEqual(sub);
    const corrupt = Buffer.from(encrypted, "base64"); corrupt[30] ^= 1;
    expect(() => decryptSubscription(corrupt.toString("base64"), secret)).toThrow();
    expect(pushSubscriptionSchema.safeParse({ ...sub, keys: { ...sub.keys, p256dh: Buffer.alloc(65).toString("base64url") } }).success).toBe(false);
  });
  it("binds receipts to exactly one delivery and keeps absent config disabled", () => {
    const secret = randomBytes(32).toString("base64");
    const token = pushReceiptToken("a", secret);
    expect(validPushReceipt("a", token, secret)).toBe(true);
    expect(validPushReceipt("b", token, secret)).toBe(false);
    expect(validPushReceipt("a", "forged", secret)).toBe(false);
    expect(pushConfig({})).toBeNull();
    expect(pushConfig({ WEB_PUSH_ENABLED: "true" })).toBeNull();
  });
});
