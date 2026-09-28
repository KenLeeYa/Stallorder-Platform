import { describe, expect, it, vi } from "vitest";
import { verifyPlatformFriendship } from "./friendship";
import { hashPlatformSubject } from "./crypto";

const subject = `U${"a".repeat(32)}`;
const binding = { channelId: "123", providerId: "456", environment: "preview",
  subjectHash: hashPlatformSubject("preview", "456", subject) };
function provider(overrides: { token?: unknown; profile?: unknown; friend?: unknown; status?: number } = {}) {
  return vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url)).pathname;
    return Response.json(path.endsWith("/verify") ? overrides.token ?? { client_id: "123", expires_in: 60, scope: "openid profile" }
      : path === "/v2/profile" ? overrides.profile ?? { userId: subject }
      : overrides.friend ?? { friendFlag: true }, { status: overrides.status ?? 200 });
  });
}
describe("server-verified platform friendship", () => {
  it("recognizes a pre-existing friend without requiring a new follow event", async () => {
    const fetchImpl = provider();
    expect(await verifyPlatformFriendship("test-token", binding, fetchImpl)).toBe(true);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/oauth2/v2.1/verify", "/v2/profile", "/friendship/v1/status",
    ]);
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({ redirect: "error", cache: "no-store", headers: { Authorization: "Bearer test-token" } });
  });
  it("keeps blocked/non-friends separate from members and notification consent", async () => {
    expect(await verifyPlatformFriendship("test-token", binding, provider({ friend: { friendFlag: false } }))).toBe(false);
  });
  it.each([
    { client_id: "other", expires_in: 60, scope: "profile" },
    { client_id: "123", expires_in: 0, scope: "profile" },
    { client_id: "123", expires_in: 60, scope: "openid" },
  ])("rejects another channel, expired token or missing profile scope", async token => {
    const fetchImpl = provider({ token });
    await expect(verifyPlatformFriendship("test-token", binding, fetchImpl)).rejects.toThrow("FRIENDSHIP_UNVERIFIED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects another LINE user before checking or recording friendship", async () => {
    const fetchImpl = provider({ profile: { userId: `U${"b".repeat(32)}` } });
    await expect(verifyPlatformFriendship("test-token", binding, fetchImpl)).rejects.toThrow("FRIENDSHIP_UNVERIFIED");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([{ friendFlag: "true" }, {}, { friendFlag: 1 }])("does not trust truthy or missing provider flags", async friend => {
    await expect(verifyPlatformFriendship("test-token", binding, provider({ friend }))).rejects.toThrow("FRIENDSHIP_UNVERIFIED");
  });
  it("never exposes a token-bearing provider error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("https://api.line.me/?access_token=test-token"); });
    await expect(verifyPlatformFriendship("test-token", binding, fetchImpl)).rejects.toThrow(/^LINE_PLATFORM_FRIENDSHIP_UNAVAILABLE$/);
  });
  it("rejects provider denial without treating it as a friendship decision", async () => {
    await expect(verifyPlatformFriendship("test-token", binding, provider({ status: 401 }))).rejects.toThrow("FRIENDSHIP_UNVERIFIED");
  });
});
