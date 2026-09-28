import "server-only";
import { prisma } from "@/lib/prisma";
import { createOpaqueToken, hashToken, safeEqual } from "@/lib/security";
import { safeMiniAppReturnPath } from "@/lib/line-miniapp-links";
import { completeOAuthLogin } from "@/server/auth/oauth/identity-service";
import { encryptOAuthValue, requireOAuthStateSecret } from "@/server/auth/oauth/crypto";
import { verifyMiniAppIdentity } from "./identity";
import type { MiniAppBinding } from "./configuration";
import { getMiniAppStall, miniAppBindingFingerprint } from "./runtime";
import { encryptPlatformValue } from "@/server/line-platform/crypto";

export const MINI_APP_CHALLENGE_COOKIE = "stallorder_mini_challenge";
export const MINI_APP_CHALLENGE_TTL_SECONDS = 300;

export async function createMiniAppLoginChallenge(binding: MiniAppBinding, returnTo: string) {
  await getMiniAppStall(binding);
  const challenge = createOpaqueToken();
  const browserSecret = createOpaqueToken();
  const expiresAt = new Date(Date.now() + MINI_APP_CHALLENGE_TTL_SECONDS * 1000);
  await prisma.oAuthTransaction.create({ data: {
    provider: "LINE", flow: "LINE_MINIAPP", contextFingerprint: miniAppBindingFingerprint(binding),
    stateHash: hashToken(challenge), nonceHash: hashToken(browserSecret),
    // No LIFF nonce/PKCE parameters are invented. This existing encrypted field
    // records the exchange purpose; browser binding is the nonce_hash above.
    codeVerifierCiphertext: encryptOAuthValue("LINE_MINIAPP_ID_TOKEN_EXCHANGE_V1", requireOAuthStateSecret()),
    redirectUri: new URL("/api/mini/auth/exchange", binding.endpointUrl).href,
    returnTo: safeMiniAppReturnPath(returnTo), expiresAt,
  } });
  return { challenge, browserSecret, expiresAt };
}

type SessionEvidence = Parameters<typeof completeOAuthLogin>[0]["sessionEvidence"];

export async function exchangeMiniAppLogin(input: {
  binding: MiniAppBinding; challenge: string; browserSecret: string; rawIdToken: string;
  requestId: string; sessionEvidence: SessionEvidence;
}, dependencies: { fetchImpl?: typeof fetch } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.challenge) || !/^[A-Za-z0-9_-]{43}$/.test(input.browserSecret)) {
    throw new Error("LINE_MINIAPP_CHALLENGE_INVALID");
  }
  const fingerprint = miniAppBindingFingerprint(input.binding);
  const pending = await prisma.oAuthTransaction.findUnique({ where: { stateHash: hashToken(input.challenge) } });
  if (!pending || pending.flow !== "LINE_MINIAPP" || pending.provider !== "LINE"
    || pending.status !== "PENDING" || pending.expiresAt <= new Date() || pending.linkMode
    || pending.contextFingerprint !== fingerprint || !safeEqual(pending.nonceHash, hashToken(input.browserSecret))) {
    throw new Error("LINE_MINIAPP_CHALLENGE_INVALID");
  }
  await getMiniAppStall(input.binding);
  // Claim before the external request; simultaneous POSTs cannot verify/create two sessions.
  const claimed = await prisma.oAuthTransaction.updateMany({
    where: { id: pending.id, flow: "LINE_MINIAPP", status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "PROCESSING", circuitSource: "B" },
  });
  if (claimed.count !== 1) throw new Error("LINE_MINIAPP_CHALLENGE_INVALID");
  try {
    const identity = await verifyMiniAppIdentity(input.rawIdToken, input.binding, dependencies);
    return await completeOAuthLogin({
      transactionId: pending.id, miniAppContextFingerprint: fingerprint,
      requestId: input.requestId, sessionEvidence: input.sessionEvidence,
      claims: { provider: "LINE", subject: identity.subject, email: null, emailVerified: false,
        displayName: "LINE 顧客", avatarUrl: null,
        metadata: { flow: "LINE_MINIAPP", channelId: identity.channelId, providerId: identity.providerId,
          internalChannel: identity.internalChannel,
          ...(input.binding.scope === "PLATFORM" ? { environment: input.binding.deployment,
            subjectCiphertext: encryptPlatformValue(identity.lineSubject) } : {}) } },
    });
  } catch (error) {
    await prisma.oAuthTransaction.updateMany({ where: { id: pending.id, status: "PROCESSING" }, data: { status: "FAILED" } });
    throw error;
  }
}
