import "server-only";
import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { createClient } from "@supabase/supabase-js";
import type { Prisma } from "@prisma/client";
import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { digest } from "./crypto";
import { ComplianceError, requireCompliance } from "./access";

const audiences = new Set(["authenticated"]);
const actions = new Set(["PRIVACY_APPROVE", "PRIVACY_EXPORT", "PRIVACY_DELETE", "SUPPORT_GRANT", "RETENTION_POLICY", "PAYOUT_CHANGE"]);
export function complianceMfaAvailable(authUserId: string | null | undefined) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const issuer = process.env.COMPLIANCE_MFA_ISSUER;
  if (!authUserId || !base || !issuer || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.COMPLIANCE_MFA_AUDIENCE !== "authenticated") return false;
  try { return new URL(issuer).protocol === "https:" && issuer === `${base.replace(/\/$/, "")}/auth/v1`; }
  catch { return false; }
}
export async function verifyMfaProof(token: string, authUserId: string, options: {
  issuer: string; audience: string; key: JWTVerifyGetKey; now?: Date;
}) {
  if (!audiences.has(options.audience)) throw new ComplianceError("MFA_CONFIGURATION_REQUIRED", 503);
  const now = options.now ?? new Date();
  const { payload } = await jwtVerify(token, options.key, { issuer: options.issuer, audience: options.audience,
    algorithms: ["RS256", "ES256"], currentDate: now, requiredClaims: ["exp", "sub", "iat", "aal"] });
  const methods = Array.isArray(payload.amr) ? payload.amr : [];
  const freshMfa = methods.some((method: unknown) => {
    if (!method || typeof method !== "object") return false;
    const entry = method as Record<string, unknown>;
    return ["totp", "webauthn", "phone"].includes(String(entry.method)) && typeof entry.timestamp === "number"
      && entry.timestamp <= now.getTime() / 1000 && entry.timestamp > now.getTime() / 1000 - 300;
  });
  if (payload.sub !== authUserId || payload.aal !== "aal2" || !freshMfa) throw new ComplianceError("MFA_PROOF_INVALID", 403);
}
export async function issueStepUp(principal: SessionPrincipal, input: { token: string; action: string; contentDigest: string }) {
  requireCompliance();
  if (!actions.has(input.action) || !/^[a-f0-9]{64}$/.test(input.contentDigest)) throw new ComplianceError("STEP_UP_SCOPE_INVALID", 400);
  if (!principal.user.authUserId) throw new ComplianceError("MFA_IDENTITY_NOT_LINKED", 503);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const issuer = process.env.COMPLIANCE_MFA_ISSUER;
  const audience = process.env.COMPLIANCE_MFA_AUDIENCE;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !issuer || !audience || !publishableKey || !complianceMfaAvailable(principal.user.authUserId)) {
    throw new ComplianceError("MFA_CONFIGURATION_REQUIRED", 503);
  }
  await verifyMfaProof(input.token, principal.user.authUserId, { issuer, audience, key: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) });
  const auth = createClient(base, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const user = await auth.auth.getUser(input.token);
  if (user.error || user.data.user?.id !== principal.user.authUserId) throw new ComplianceError("MFA_PROOF_INVALID", 403);
  const grant = randomBytes(32).toString("base64url");
  const created = await prisma.$executeRaw`insert into public.security_step_up_grants (session_id, action, content_digest, token_hash, assurance, expires_at)
    select session.id, ${input.action}, ${input.contentDigest}, ${digest(grant)}, 'aal2', now() + interval '5 minutes'
    from public.auth_sessions session join public.profiles profile on profile.id = session.profile_id
    where session.id = ${principal.sessionId}::uuid and session.revoked_at is null and session.expires_at > now()
      and profile.is_active and session.profile_session_version = profile.session_version`;
  if (created !== 1) throw new ComplianceError("SESSION_REVOKED", 401);
  return { grant, expiresInSeconds: 300 };
}
export async function consumeStepUp(tx: Prisma.TransactionClient, principal: SessionPrincipal,
  action: string, contentDigest: string, token: string | null) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ComplianceError("STEP_UP_REQUIRED", 403);
  const used = await tx.$executeRaw`update public.security_step_up_grants grant_row set consumed_at = now()
    from public.auth_sessions session join public.profiles profile on profile.id = session.profile_id
    where grant_row.token_hash = ${digest(token)} and grant_row.session_id = session.id
      and session.id = ${principal.sessionId}::uuid and session.profile_id = ${principal.user.id}::uuid
      and session.revoked_at is null and session.expires_at > now() and profile.is_active
      and session.profile_session_version = profile.session_version and grant_row.consumed_at is null
      and grant_row.expires_at > now() and grant_row.action = ${action} and grant_row.content_digest = ${contentDigest}`;
  if (used !== 1) throw new ComplianceError("STEP_UP_REQUIRED", 403);
}
