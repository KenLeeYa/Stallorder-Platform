import { loadEnvFile } from "node:process";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getRequestPrincipal } from "@/lib/auth";
import { claimOAuthTransaction, createOAuthTransaction } from "@/server/auth/oauth/transaction-service";
import { completeOAuthLogin } from "@/server/auth/oauth/identity-service";
import { createMiniAppLoginChallenge, exchangeMiniAppLogin } from "./login-service";
import { POST as challengePost } from "@/app/api/mini/auth/challenge/route";
import { POST as exchangePost } from "@/app/api/mini/auth/exchange/route";
import type { MiniAppBinding } from "./configuration";

const binding: MiniAppBinding = { organizationId: "11111111-1111-4111-8111-111111111111",
  stallId: "22222222-2222-4222-8222-222222222222", providerId: "100", channelId: "200",
  liffId: "200-test", internalChannel: "developing", endpointUrl: "https://mini.local.test/mini", deployment: "local" };
const evidence = { deviceId: "77777777-7777-4777-8777-777777777777", deviceLabel: "Local integration fixture", ipHash: "0".repeat(64), userAgentHash: "1".repeat(64) };
const subject = () => `U${randomBytes(16).toString("hex")}`;
function provider(sub: string, aud = "200") {
  return vi.fn<typeof fetch>(async () => Response.json({ iss: "https://access.line.me", sub, aud,
    iat: Math.floor(Date.now() / 1000) - 1, exp: Math.floor(Date.now() / 1000) + 600 }));
}
function exchange(challenge: Awaited<ReturnType<typeof createMiniAppLoginChallenge>>, fetchImpl: typeof fetch) {
  return exchangeMiniAppLogin({ binding, ...challenge, rawIdToken: "fixture-id-token", requestId: "miniapp-integration", sessionEvidence: evidence }, { fetchImpl });
}

describe.runIf(process.env.LINE_MINIAPP_DB_QA === "true")("MINI App real local DB / provider fixture", () => {
  beforeAll(async () => {
    loadEnvFile(".env.local");
    const database = new URL(process.env.DATABASE_URL!);
    if (database.hostname !== "127.0.0.1" || database.port !== "55722" || database.pathname !== "/stallorder_line_miniapp_20260926") throw new Error("ISOLATED_LOCAL_DB_REQUIRED");
    vi.stubEnv("LINE_MINIAPP_ENABLED", "true");
    vi.stubEnv("LINE_MINIAPP_BINDING_JSON", JSON.stringify(binding));
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

  it("POST challenge → provider verify → existing device-bound session; customer has no operator access", async () => {
    const fetchImpl = provider(subject());
    vi.stubGlobal("fetch", fetchImpl);
    const headers = { origin: "https://mini.local.test", "content-type": "application/json", "sec-fetch-site": "same-origin" };
    const challengeResponse = await challengePost(new Request("https://mini.local.test/api/mini/auth/challenge", {
      method: "POST", headers, body: JSON.stringify({ returnTo: "/mini" }),
    }));
    expect(challengeResponse.status).toBe(200);
    expect(challengeResponse.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(challengeResponse.headers.get("set-cookie")).toMatch(/Secure/);
    const cookie = challengeResponse.cookies.get("stallorder_mini_challenge")!;
    const response = await exchangePost(new Request("https://mini.local.test/api/mini/auth/exchange", {
      method: "POST", headers: { ...headers, cookie: `${cookie.name}=${cookie.value}` },
      body: JSON.stringify({ ...(await challengeResponse.json()), idToken: "fixture-id-token" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ returnTo: "/mini" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const principal = await getRequestPrincipal(new Request("https://mini.local.test/mini", {
      headers: { cookie: response.cookies.getAll().map(c => `${c.name}=${c.value}`).join("; ") },
    }));
    expect(principal?.user.platformRole).toBeNull();
    expect(await prisma.organizationMembership.count({ where: { profileId: principal!.user.id } })).toBe(0);
    expect(await prisma.stallMembership.count({ where: { profileId: principal!.user.id } })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toContain("client_id=200");
  });

  it("consumes only once under simultaneous exchanges, then rejects replay", async () => {
    const challenge = await createMiniAppLoginChallenge(binding, "/mini");
    const fetchImpl = provider(subject());
    const results = await Promise.allSettled([exchange(challenge, fetchImpl), exchange(challenge, fetchImpl)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(exchange(challenge, fetchImpl)).rejects.toThrow("LINE_MINIAPP_CHALLENGE_INVALID");
  });

  it("rejects wrong browser, environment change and expired challenge before contacting LINE", async () => {
    const challenge = await createMiniAppLoginChallenge(binding, "/mini");
    const fetchImpl = provider(subject());
    await expect(exchange({ ...challenge, browserSecret: "x".repeat(43) }, fetchImpl)).rejects.toThrow("CHALLENGE_INVALID");
    await expect(exchangeMiniAppLogin({ ...challenge, binding: { ...binding, channelId: "201" }, rawIdToken: "fixture", requestId: "fixture", sessionEvidence: evidence }, { fetchImpl })).rejects.toThrow("CHALLENGE_INVALID");
    await prisma.oAuthTransaction.updateMany({ where: { flow: "LINE_MINIAPP", status: "PENDING" }, data: { createdAt: new Date(Date.now() - 600_000), expiresAt: new Date(Date.now() - 1000) } });
    await expect(exchange(challenge, fetchImpl)).rejects.toThrow("CHALLENGE_INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects other audience and persists failure without saving the raw token", async () => {
    const challenge = await createMiniAppLoginChallenge(binding, "/mini");
    await expect(exchange(challenge, provider(subject(), "999"))).rejects.toThrow("ID_TOKEN_INVALID");
    await expect(exchange(challenge, provider(subject()))).rejects.toThrow("CHALLENGE_INVALID");
  });

  it("rejects cross-origin POST and client-supplied tenant fields", async () => {
    expect((await challengePost(new Request("https://mini.local.test/api/mini/auth/challenge", { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" }))).status).toBe(403);
    expect((await challengePost(new Request("https://mini.local.test/api/mini/auth/challenge", { method: "POST", headers: { origin: "https://mini.local.test" }, body: JSON.stringify({ organizationId: binding.organizationId }) }))).status).toBe(400);
  });

  it("normal OAuth callback cannot consume a MINI challenge", async () => {
    const challenge = await createMiniAppLoginChallenge(binding, "/mini");
    await expect(claimOAuthTransaction({ provider: "LINE", state: challenge.challenge, authorizationCode: "fixture-code" })).rejects.toThrow("OAUTH_TRANSACTION_NOT_FOUND");
    await expect(exchange(challenge, provider(subject()))).resolves.toMatchObject({ newProfile: true });
  });

  it("the migration preserves the ordinary OAuth → existing session flow", async () => {
    const ordinary = await createOAuthTransaction({ provider: "LINE", redirectUri: "https://mini.local.test/api/auth/line/callback" });
    const claimed = await claimOAuthTransaction({ provider: "LINE", state: ordinary.state, authorizationCode: randomBytes(24).toString("hex") });
    expect(claimed.status).toBe("CLAIMED");
    const result = await completeOAuthLogin({ transactionId: ordinary.transactionId, requestId: "ordinary-oauth-regression", sessionEvidence: evidence,
      claims: { provider: "LINE", subject: subject(), email: null, emailVerified: false, displayName: "OAuth fixture", avatarUrl: null, metadata: {} } });
    expect(result.session.id).toBeTruthy();
    expect(result.newProfile).toBe(true);
  });

  it("re-login reuses the customer profile but refuses an elevated customer", async () => {
    const fetchImpl = provider(subject());
    const first = await exchange(await createMiniAppLoginChallenge(binding, "/mini"), fetchImpl);
    const second = await exchange(await createMiniAppLoginChallenge(binding, "/mini"), fetchImpl);
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.session.id).not.toBe(first.session.id);
    await prisma.stallMembership.create({ data: { organizationId: binding.organizationId!, stallId: binding.stallId!, profileId: first.profile.id, role: "STAFF" } });
    await expect(exchange(await createMiniAppLoginChallenge(binding, "/mini"), fetchImpl)).rejects.toThrow("OPERATOR_IDENTITY_REJECTED");
  });
});
