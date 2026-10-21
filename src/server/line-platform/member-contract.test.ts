import { afterEach, describe, expect, it, vi } from "vitest";
import { getLinePlatformRuntime, platformDatabaseFingerprint } from "./runtime";
import { decryptPlatformValue, encryptPlatformValue, hashPlatformSubject } from "./crypto";
import { verifyMiniAppIdentity } from "../line-miniapp/identity";
import { buildMiniAppOrderLink, safeMiniAppReturnPath } from "@/lib/line-miniapp-links";
import { redactPerformanceUrl } from "@/lib/performance-url-redaction";

const config = { environment: "local", providerId: "1234567", channelId: "1234568", liffId: "1234568-fixture", internalChannel: "developing", endpointUrl: "https://pickup.local.test/mini", oaDestination: `U${"a".repeat(32)}`, oaChannelId: "1234569", oaAccessTokenReference: "11111111-1111-4111-8111-111111111111", oaSecretReference: "22222222-2222-4222-8222-222222222222", termsVersion: "test-v1" };
const env = { NODE_ENV: "test", LINE_PLATFORM_ENABLED: "true", LINE_PLATFORM_ENVIRONMENT: "local", LINE_PLATFORM_BINDING_JSON: JSON.stringify(config) } as NodeJS.ProcessEnv;
afterEach(() => vi.unstubAllEnvs());
describe("platform membership boundary", () => {
  it("all provider capabilities are off by default and disabled config is not evaluated", () => {
    expect(getLinePlatformRuntime({ NODE_ENV: "test", LINE_PLATFORM_BINDING_JSON: "not-json" })).toBeNull();
    expect(getLinePlatformRuntime(env)).toMatchObject({ notificationsEnabled: false, pickupEnabled: false, payEnabled: false });
  });
  it.each([
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { LINE_PLATFORM_ENVIRONMENT: "production" },
    { LINE_PLATFORM_BINDING_JSON: JSON.stringify({ ...config, endpointUrl: "https://app.qidaigo.com/mini" }) },
    { LINE_PLATFORM_BINDING_JSON: JSON.stringify({ ...config, endpointUrl: "https://pickup.local.test/mini?trackingToken=private" }) },
    { LINE_PLATFORM_BINDING_JSON: JSON.stringify({ ...config, addFriendUrl: "https://attacker.invalid/steal" }) },
  ])("rejects a deployment or external-link mismatch %j", (override) => {
    expect(() => getLinePlatformRuntime({ ...env, ...override } as NodeJS.ProcessEnv)).toThrow();
  });
  it("rejects Preview using Production DB settings even with a valid preview audience", () => {
    const previewDb="postgresql://postgres.preview:synthetic@pool.example.test:6543/postgres";
    const previewEnv={...env,VERCEL_ENV:"preview",LINE_PLATFORM_ENVIRONMENT:"preview",DATABASE_URL:previewDb,
      LINE_PLATFORM_BINDING_JSON:JSON.stringify({...config,environment:"preview"}),
      LINE_PLATFORM_DATABASE_BINDING_JSON:JSON.stringify({environment:"preview",fingerprint:platformDatabaseFingerprint(previewDb)})};
    expect(getLinePlatformRuntime(previewEnv)?.environment).toBe("preview");
    expect(()=>getLinePlatformRuntime({...previewEnv,DATABASE_URL:"postgresql://postgres.production:synthetic@pool.example.test:6543/postgres"})).toThrow("DATABASE_MISMATCH");
    expect(()=>getLinePlatformRuntime({...previewEnv,LINE_PLATFORM_DATABASE_BINDING_JSON:JSON.stringify({environment:"production",fingerprint:platformDatabaseFingerprint(previewDb)})})).toThrow("DATABASE_MISMATCH");
  });
  it("uses one identity per environment/provider across verified channels, never email", async () => {
    const binding = { scope: "PLATFORM" as const, deployment: "local" as const, providerId: "1234567", channelId: "1234568", liffId: "1234568-fixture", internalChannel: "developing" as const, endpointUrl: "https://pickup.local.test/mini" };
    const verify = (channelId: string, providerId = binding.providerId, deployment: "local" | "preview" = "local") => verifyMiniAppIdentity("fixture", { ...binding, channelId, providerId, deployment }, {
      now: () => 1_900_000_000,
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ sub: `U${"b".repeat(32)}`, aud: channelId, iss: "https://access.line.me", iat: 1_899_999_999, exp: 1_900_000_100, email: "same@example.test", role: "OWNER" }))),
    });
    const first = await verify("1234568");
    expect((await verify("9876543")).subject).toBe(first.subject);
    expect((await verify("1234568", "9999999")).subject).not.toBe(first.subject);
    expect((await verify("1234568", "1234567", "preview")).subject).not.toBe(first.subject);
    expect(first).not.toHaveProperty("email"); expect(first).not.toHaveProperty("role");
    expect(first.subject).not.toContain(`U${"b".repeat(32)}`);
  });
  it("encrypts recipient material with integrity and purpose binding", () => {
    vi.stubEnv("LINE_PLATFORM_DATA_KEY", Buffer.alloc(32, 42).toString("base64"));
    const raw = `U${"c".repeat(32)}`;
    const encrypted = encryptPlatformValue(raw, "recipient");
    expect(encrypted).not.toContain(raw); expect(decryptPlatformValue(encrypted, "recipient")).toBe(raw);
    expect(encryptPlatformValue(raw, "recipient")).not.toBe(encrypted);
    expect(() => decryptPlatformValue(encrypted, "pickup")).toThrow();
    expect(hashPlatformSubject("local","1",raw)).not.toBe(hashPlatformSubject("production","1",raw));
    vi.stubEnv("LINE_PLATFORM_DATA_KEY", ""); expect(() => decryptPlatformValue(encrypted, "recipient")).toThrow();
  });
  it("keeps private order deep links inside MINI but never transports bearer credentials", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(buildMiniAppOrderLink(config.liffId,id)).toBe(`https://miniapp.line.me/${config.liffId}/orders/${id}`);
    expect(safeMiniAppReturnPath(`/mini/orders/${id}`)).toBe(`/mini/orders/${id}`);
    expect(safeMiniAppReturnPath(`/mini/orders/${id}?token=private`)).toBe("/mini");
    expect(safeMiniAppReturnPath("/mini/member")).toBe("/mini/member");
    expect(redactPerformanceUrl("https://test.invalid/api/line-platform/media/secret?token=secret")).not.toContain("secret");
    expect(redactPerformanceUrl(`https://test.invalid/mini/orders/${id}`)).not.toContain(id);
  });
});
