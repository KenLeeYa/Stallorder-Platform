import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";

export async function assertPreviewDatabasePrincipal(response: Response, started: number, finished: number) {
  assert.equal(response.status, 200, "PREVIEW_PRINCIPAL_INVALID");
  const cache = response.headers.get("cache-control") ?? "";
  assert.ok(cache.includes("private") && cache.includes("no-store"), "PREVIEW_PRINCIPAL_INVALID");
  const body = await response.json();
  assert.deepEqual(body, { schema: "stallorder-database-principal/v1", currentUser: "postgres",
    sessionUser: "postgres", database: "postgres", superuser: false, bypassRls: true,
    helperExists: true, helperExecute: true, observedAt: body?.observedAt }, "PREVIEW_PRINCIPAL_INVALID");
  assert.ok(typeof body.observedAt === "string" && Date.parse(body.observedAt) >= started
    && Date.parse(body.observedAt) <= finished, "PREVIEW_PRINCIPAL_INVALID");
  return body;
}

type Input = { origin: string; headers: Record<string, string>; sourceSha: string;
  ref: string; parentRef: string; supabaseUrl: string; databaseUrl: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

// Synthetic credentials prove the deployed application's SQL identity and ACL;
// this probe does not claim live OAuth or password-login acceptance.
export async function verifyPreviewDatabasePrincipal(db: PrismaClient, input: Input, fetchImpl = fetch) {
  assert.ok(process.env.GITHUB_ACTIONS === "true" && process.env.VERCEL_ENV === "preview"
    && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform", "PREVIEW_PRINCIPAL_INVOCATION_INVALID");
  assertIsolatedStorageQa(input);
  assert.equal(input.ref, "teunnvfakbfzmodajqjz", "PREVIEW_PRINCIPAL_TARGET_INVALID");
  assert.equal(input.parentRef, "eyuctbnlvnbnivwasvqr", "PREVIEW_PRINCIPAL_TARGET_INVALID");
  assert.match(input.origin, /^https:\/\/stallorder-platform-[a-z0-9]+-ada76145-8663s-projects\.vercel\.app$/);
  assert.match(input.sourceSha, /^[a-f0-9]{40}$/);
  const request = (route: string, cookie?: string) => fetchImpl(input.origin + route, {
    headers: { ...input.headers, ...(cookie ? { cookie } : {}), "user-agent": "stallorder-preview-principal" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  const version = await request("/api/version");
  assert.ok(version.ok && (await version.json()).revision === input.sourceSha, "PREVIEW_PRINCIPAL_SOURCE_INVALID");
  const assertDenied = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, "PREVIEW_PRINCIPAL_DENIAL_INVALID");
    assert.ok(response.headers.get("cache-control")?.includes("no-store"), "PREVIEW_PRINCIPAL_DENIAL_INVALID");
    const body = await response.json();
    assert.ok(!body.currentUser && !body.sessionUser, "PREVIEW_PRINCIPAL_DENIAL_INVALID");
  };
  await assertDenied(await request("/api/health/database-principal"), 401);
  const profileId = randomUUID();
  const sessionId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hash(token);
  const deviceId = randomUUID();
  const email = `preview-principal-${profileId}@stallorder.invalid`;
  const cookie = `stallorder_session=${token}; stallorder_auth_device=${deviceId}`;
  const bucketKey = hash(`platform-billing-api:${profileId}`);
  const foreignBuckets = async () => {
    const rows = await db.$queryRaw<Array<{ snapshot: string }>>`
      SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.key), '[]'::jsonb)::text AS snapshot
      FROM public.rate_limit_buckets b WHERE b.key <> ${bucketKey}
    `;
    assert.ok(rows.length === 1 && typeof rows[0].snapshot === "string", "PREVIEW_PRINCIPAL_RATE_SNAPSHOT_INVALID");
    return hash(rows[0].snapshot);
  };
  const foreignBefore = await foreignBuckets();
  let receipt: unknown;
  try {
    // The IDs and ownership marker exist before the transaction: uncertain
    // COMMIT outcomes are still reconciled by the exact cleanup below.
    await db.profile.create({ data: { id: profileId, email, displayName: "Preview principal QA",
      platformRole: "PLATFORM_ADMIN", isActive: true, sessionVersion: 1,
      sessions: { create: { id: sessionId, tokenHash, csrfTokenHash: hash(randomUUID()), deviceId,
        profileSessionVersion: 1, expiresAt: new Date(Date.now() + 5 * 60_000) } } } });
    const started = Date.now();
    const response = await request("/api/health/database-principal", cookie);
    const finished = Date.now();
    const principal = await assertPreviewDatabasePrincipal(response, started, finished);
    await db.profile.update({ where: { id: profileId }, data: { platformRole: null } });
    await assertDenied(await request("/api/health/database-principal", cookie), 404);
    await db.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await assertDenied(await request("/api/health/database-principal", cookie), 401);
    receipt = { sourceSha: input.sourceSha, backend: input.ref, origin: input.origin, principal,
      requestStartedAt: new Date(started).toISOString(), requestFinishedAt: new Date(finished).toISOString(),
      anonymousDenied: true, nonAdminDenied: true, revokedSessionDenied: true,
      authentication: "owned-synthetic-session-not-live-provider", productionRuntimeVerified: false };
  } finally {
    await db.$transaction(async tx => {
      const owned = await tx.profile.findUnique({ where: { id: profileId }, select: { email: true, authUserId: true } });
      if (owned) {
        assert.ok(owned.email === email && owned.authUserId === null, "PREVIEW_PRINCIPAL_CLEANUP_OWNERSHIP");
        await tx.auditLog.deleteMany({ where: { actorProfileId: profileId, action: "AUTHORIZATION_DENIED", entityType: "PLATFORM_BILLING" } });
        await tx.rateLimitBucket.deleteMany({ where: { key: bucketKey, scope: "platform-billing-api" } });
        await tx.authSession.deleteMany({ where: { id: sessionId, profileId, tokenHash } });
        // Check before profile deletion: SET NULL / CASCADE must not conceal leftovers.
        assert.equal(await tx.auditLog.count({ where: { actorProfileId: profileId } }), 0, "PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE");
        assert.equal(await tx.authSession.count({ where: { profileId } }), 0, "PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE");
        await tx.profile.delete({ where: { id: profileId } });
      }
      assert.equal(await tx.profile.count({ where: { id: profileId } }), 0, "PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE");
      assert.equal(await tx.authSession.count({ where: { id: sessionId } }), 0, "PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE");
      assert.equal(await tx.rateLimitBucket.count({ where: { key: bucketKey } }), 0, "PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE");
      assert.equal(await tx.auditLog.count({ where: { actorProfileId: profileId } }), 0, "PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE");
    }, { isolationLevel: "Serializable" });
    assert.equal(await foreignBuckets(), foreignBefore, "PREVIEW_PRINCIPAL_FOREIGN_BUCKET_CHANGED");
  }
  return { ...(receipt as Record<string, unknown>), ownedProbeCleanupVerified: true, foreignRateBucketsPreserved: true };
}
