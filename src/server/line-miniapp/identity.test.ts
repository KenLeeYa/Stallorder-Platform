import { describe, expect, it, vi } from "vitest";
import { verifyMiniAppIdentity } from "./identity";
import { validateMiniAppBinding } from "./configuration";

const binding = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  stallId: "22222222-2222-4222-8222-222222222222",
  providerId: "12345", channelId: "54321", liffId: "54321-abcde",
  internalChannel: "developing" as const,
  endpointUrl: "https://qa.example.test/mini", deployment: "local" as const,
};
const now = 1_800_000_000;
const claims = { iss: "https://access.line.me", aud: "54321", sub: `U${"a".repeat(32)}`, exp: now + 600, iat: now - 10 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("MINI App verified identity boundary", () => {
  it("verifies raw ID token server-side without inventing a LIFF OAuth nonce", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(claims));
    const identity = await verifyMiniAppIdentity("synthetic-id-token", binding, { fetchImpl, now: () => now });
    expect(identity).toEqual({ provider: "LINE", subject: `miniapp:12345:developing:54321:${claims.sub}`, channelId: "54321", providerId: "12345", internalChannel: "developing" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(fetchImpl.mock.calls[0][1].body.toString()).toBe("id_token=synthetic-id-token&client_id=54321");
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });

  it.each([
    { iss: "https://evil.example" }, { aud: "different-channel" }, { exp: now - 1 },
    { iat: now + 1000 }, { sub: "" },
  ])("rejects invalid verified claims %j", async (override) => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ...claims, ...override }));
    await expect(verifyMiniAppIdentity("synthetic-id-token", binding, { fetchImpl, now: () => now })).rejects.toThrow("LINE_MINIAPP_ID_TOKEN_INVALID");
  });

  it("cannot accept developing tokens in production or published tokens in preview", () => {
    expect(() => validateMiniAppBinding({ ...binding, deployment: "production" })).toThrow("LINE_MINIAPP_ENVIRONMENT_MISMATCH");
    expect(() => validateMiniAppBinding({ ...binding, deployment: "preview", internalChannel: "published" })).toThrow("LINE_MINIAPP_ENVIRONMENT_MISMATCH");
  });

  it("same user ID in another Provider is a different identity; email is ignored", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(response({ ...claims, email: "same@example.test", role: "OWNER" })));
    const first = await verifyMiniAppIdentity("synthetic", binding, { fetchImpl, now: () => now });
    const second = await verifyMiniAppIdentity("synthetic", { ...binding, providerId: "67890" }, { fetchImpl, now: () => now });
    expect(first.subject).not.toBe(second.subject);
    expect(first).not.toHaveProperty("email");
    expect(first).not.toHaveProperty("role");
  });

  it("does not expose provider errors or token text", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("raw token is synthetic-id-token"));
    await expect(verifyMiniAppIdentity("synthetic-id-token", binding, { fetchImpl })).rejects.toThrow(/^LINE_MINIAPP_VERIFY_UNAVAILABLE$/);
  });
});
