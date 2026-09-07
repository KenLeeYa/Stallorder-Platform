import { beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, privateDecrypt, constants, createDecipheriv } from "node:crypto";
import { createPublicOrderSecretRecoveryHandler } from "./public-order-secret-recovery.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const values = { ABUSE_HASH_SECRET: "test-original-abuse", TOKEN_DERIVATION_SECRET: "test-original-token" };
const now = 1_789_000_000_000;
let config;
let privateKey;
beforeAll(() => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 4096 });
  privateKey = keys.privateKey;
  config = { projectRef: "abcdefghijklmnopqrst", recoveryId: "test-recovery", createdAt: now - 1000, expiresAt: now + 299_000,
    serviceAuthorizationHash: hash("Bearer service-role-key"),
    nonceHash: hash("a".repeat(64)), recipientPublicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    digests: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, hash(value)])) };
});

function handler(options = {}) {
  const env = { ...values, SUPABASE_URL: `https://${config.projectRef}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "service-role-key", ...options.env };
  return createPublicOrderSecretRecoveryHandler({ ...config, ...options.config }, { getEnv: (name) => env[name], now: () => options.now ?? now });
}
function request(headers = {}, method = "POST") {
  return new Request("https://example.test/recover", { method, headers: { authorization: "Bearer service-role-key", "x-recovery-nonce": "a".repeat(64), ...headers } });
}

describe("encrypted public-order runtime recovery", () => {
  it("only returns an authenticated encrypted envelope decryptable by the local recipient", async () => {
    const response = await handler()(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const envelope = await response.json();
    expect(JSON.stringify(envelope)).not.toContain(values.ABUSE_HASH_SECRET);
    const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.wrappedKey, "base64"));
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(`${config.projectRef}:${config.recoveryId}`));
    decipher.setAuthTag(ciphertext.subarray(-16));
    const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
    expect(JSON.parse(plaintext.toString())).toEqual(values);
  });
  it("authenticates the exact management API service JWT even when the built-in runtime key differs", async () => {
    const response = await handler({ env: { SUPABASE_SERVICE_ROLE_KEY: "stale-runtime-service-key" } })(request());
    expect(response.status).toBe(200);
  });
  it.each([
    ["anonymous", { authorization: "" }, {}],
    ["customer JWT", { authorization: "Bearer customer-token" }, {}],
    ["stale runtime JWT", { authorization: "Bearer stale-runtime-service-key" }, { env: { SUPABASE_SERVICE_ROLE_KEY: "stale-runtime-service-key" } }],
    ["missing service authorization binding", {}, { config: { serviceAuthorizationHash: undefined } }],
    ["missing nonce", { "x-recovery-nonce": "" }, {}],
    ["wrong nonce", { "x-recovery-nonce": "b".repeat(64) }, {}],
    ["expired", {}, { now: now + 300_000 }],
    ["before validity", {}, { now: now - 2000 }],
    ["oversized lifetime", {}, { config: { expiresAt: now + 900_000 } }],
    ["wrong project", {}, { env: { SUPABASE_URL: "https://other.supabase.co" } }],
    ["missing original", {}, { env: { ABUSE_HASH_SECRET: "" } }],
    ["digest drift", {}, { env: { ABUSE_HASH_SECRET: "different" } }],
  ])("denies %s without returning secrets", async (_name, headers, options) => {
    const response = await handler(options)(request(headers));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
  it("does not support browser GET or CORS preflight", async () => {
    for (const method of ["GET", "OPTIONS"]) expect((await handler()(request({}, method))).status).toBe(404);
  });
});
