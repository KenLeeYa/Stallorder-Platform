import { describe, expect, it } from "vitest";
import { miniAppBindingFingerprint, readMiniAppBinding } from "./runtime";

const binding = { organizationId: "11111111-1111-4111-8111-111111111111", stallId: "22222222-2222-4222-8222-222222222222",
  providerId: "100", channelId: "200", liffId: "200-test", internalChannel: "developing", deployment: "local", endpointUrl: "https://mini.local.test/mini" };
const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", LINE_MINIAPP_ENABLED: "true", LINE_MINIAPP_BINDING_JSON: JSON.stringify(binding) };

describe("MINI runtime configuration", () => {
  it("defaults closed and rejects incomplete configuration", () => {
    expect(() => readMiniAppBinding({ NODE_ENV: "test" })).toThrow("DISABLED");
    expect(() => readMiniAppBinding({ ...environment, LINE_MINIAPP_BINDING_JSON: "" })).toThrow("CONFIGURATION_INVALID");
  });
  it("rejects a developing channel on Production and unbound release environment", () => {
    expect(() => readMiniAppBinding({ ...environment, VERCEL_ENV: "production" })).toThrow("ENVIRONMENT_MISMATCH");
    expect(() => readMiniAppBinding({ ...environment, NODE_ENV: "production" })).toThrow("ENVIRONMENT_MISMATCH");
    expect(readMiniAppBinding(environment).internalChannel).toBe("developing");
  });
  it("requires the served MINI endpoint and fingerprints the tenant/environment", () => {
    expect(() => readMiniAppBinding({ ...environment, LINE_MINIAPP_BINDING_JSON: JSON.stringify({ ...binding, endpointUrl: "https://mini.local.test/merchant" }) })).toThrow("ENVIRONMENT_MISMATCH");
    const current = readMiniAppBinding(environment);
    expect(miniAppBindingFingerprint(current)).not.toBe(miniAppBindingFingerprint({ ...current, providerId: "101" }));
    expect(miniAppBindingFingerprint(current)).not.toBe(miniAppBindingFingerprint({ ...current, stallId: "33333333-3333-4333-8333-333333333333" }));
  });
});


it("binds the Developing callback to the immutable isolated deployment", async () => {
  const { getLinePlatformRuntime, platformDatabaseFingerprint } = await import("../line-platform/runtime");
  const url = "postgresql://postgres.example:test@localhost:6543/postgres";
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", VERCEL_ENV: "preview", VERCEL_URL: "stallorder-platform-example-ada76145-8663s-projects.vercel.app",
    LINE_PLATFORM_ENABLED: "true", LINE_PLATFORM_ENVIRONMENT: "preview", LINE_PLATFORM_PR427_DEPLOYMENT_ENDPOINT: "true",
    DATABASE_URL: url, LINE_PLATFORM_DATABASE_BINDING_JSON: JSON.stringify({ environment: "preview", fingerprint: platformDatabaseFingerprint(url) }),
    LINE_PLATFORM_BINDING_JSON: JSON.stringify({ environment: "preview", providerId: "123", channelId: "456",
      liffId: "456-example", internalChannel: "developing", termsVersion: "preview" }) };
  expect(getLinePlatformRuntime(env)?.endpointUrl).toBe("https://" + env.VERCEL_URL + "/mini");
  for (const overrides of [{ VERCEL_URL: "app.qidaigo.com" }, { VERCEL_ENV: "production" },
    { LINE_PLATFORM_DATABASE_BINDING_JSON: "{}" }]) {
    expect(() => getLinePlatformRuntime({ ...env, ...overrides })).toThrow();
  }
});
