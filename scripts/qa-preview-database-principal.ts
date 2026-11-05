import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";
import { buildPreviewPrincipalCleanupSql } from "./qa-preview-principal-cleanup";

type ProbeStage = "preflight" | "version" | "anonymous-denial" | "foreign-before" | "fixture-create"
  | "principal-response" | "remove-admin" | "non-admin-denial" | "revoke-session" | "revoked-denial"
  | "cleanup" | "foreign-after";
const failureCodes = new Set(["PREVIEW_PRINCIPAL_INVALID", "PREVIEW_PRINCIPAL_INVOCATION_INVALID",
  "PREVIEW_PRINCIPAL_TARGET_INVALID", "PREVIEW_PRINCIPAL_SOURCE_INVALID", "PREVIEW_PRINCIPAL_DENIAL_INVALID",
  "PREVIEW_PRINCIPAL_RATE_SNAPSHOT_INVALID", "PREVIEW_PRINCIPAL_CLEANUP_OWNERSHIP",
  "PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE", "PREVIEW_PRINCIPAL_FOREIGN_BUCKET_CHANGED"]);
const probeStages = new Set<ProbeStage>(["preflight", "version", "anonymous-denial", "foreign-before", "fixture-create",
  "principal-response", "remove-admin", "non-admin-denial", "revoke-session", "revoked-denial", "cleanup", "foreign-after"]);
export function previewPrincipalFailureDetails(error: unknown, stage: ProbeStage) {
  const firstLine = error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : "";
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const reason = failureCodes.has(firstLine) ? firstLine
    : typeof code === "string" && /^P[0-9]{4}$/.test(code) ? code : "UNCLASSIFIED";
  return { stage, reason };
}
export function readPreviewPrincipalDiagnostic(error: unknown) {
  const ownValue = (object: unknown, key: string): unknown => {
    if (!object || typeof object !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const value = ownValue(error, "previewPrincipalDiagnostic");
  if (!value || typeof value !== "object") return undefined;
  const read = (key: "failure" | "finalStage") => {
    const item = ownValue(value, key);
    const stage = ownValue(item, "stage");
    const reason = ownValue(item, "reason");
    if (!probeStages.has(stage as ProbeStage) || typeof reason !== "string"
      || !(failureCodes.has(reason) || /^P[0-9]{4}$/.test(reason) || reason === "UNCLASSIFIED")) return undefined;
    return { stage, reason };
  };
  return { failure: read("failure"), finalStage: read("finalStage") };
}

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
  let stage: ProbeStage = "preflight";
  let failure: ReturnType<typeof previewPrincipalFailureDetails> | undefined;
  try {
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
  stage = "version";
  const version = await request("/api/version");
  assert.ok(version.ok && (await version.json()).revision === input.sourceSha, "PREVIEW_PRINCIPAL_SOURCE_INVALID");
  const assertDenied = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, "PREVIEW_PRINCIPAL_DENIAL_INVALID");
    assert.ok(response.headers.get("cache-control")?.includes("no-store"), "PREVIEW_PRINCIPAL_DENIAL_INVALID");
    const body = await response.json();
    assert.ok(!body.currentUser && !body.sessionUser, "PREVIEW_PRINCIPAL_DENIAL_INVALID");
  };
  stage = "anonymous-denial";
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
  stage = "foreign-before";
  const foreignBefore = await foreignBuckets();
  let receipt: unknown;
  try {
    stage = "fixture-create";
    // The IDs and ownership marker exist before the transaction: uncertain
    // COMMIT outcomes are still reconciled by the exact cleanup below.
    await db.profile.create({ data: { id: profileId, email, displayName: "Preview principal QA",
      platformRole: "PLATFORM_ADMIN", isActive: true, sessionVersion: 1,
      sessions: { create: { id: sessionId, tokenHash, csrfTokenHash: hash(randomUUID()), deviceId,
        profileSessionVersion: 1, expiresAt: new Date(Date.now() + 5 * 60_000) } } } });
    stage = "principal-response";
    const started = Date.now();
    const response = await request("/api/health/database-principal", cookie);
    const finished = Date.now();
    const principal = await assertPreviewDatabasePrincipal(response, started, finished);
    stage = "remove-admin";
    await db.profile.update({ where: { id: profileId }, data: { platformRole: null } });
    stage = "non-admin-denial";
    await assertDenied(await request("/api/health/database-principal", cookie), 404);
    stage = "revoke-session";
    await db.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    stage = "revoked-denial";
    await assertDenied(await request("/api/health/database-principal", cookie), 401);
    receipt = { sourceSha: input.sourceSha, backend: input.ref, origin: input.origin, principal,
      requestStartedAt: new Date(started).toISOString(), requestFinishedAt: new Date(finished).toISOString(),
      anonymousDenied: true, nonAdminDenied: true, revokedSessionDenied: true,
      authentication: "owned-synthetic-session-not-live-provider", productionRuntimeVerified: false };
  } catch (error) {
    failure = previewPrincipalFailureDetails(error, stage);
    throw error;
  } finally {
    stage = "cleanup";
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(buildPreviewPrincipalCleanupSql({ profileId, sessionId, tokenHash }));
    }, { isolationLevel: "Serializable" });
    stage = "foreign-after";
    assert.equal(await foreignBuckets(), foreignBefore, "PREVIEW_PRINCIPAL_FOREIGN_BUCKET_CHANGED");
  }
  return { ...(receipt as Record<string, unknown>), ownedProbeCleanupVerified: true, foreignRateBucketsPreserved: true };
  } catch (error) {
    const diagnostic = previewPrincipalFailureDetails(error, stage);
    const wrapped = new Error(failure?.reason ?? diagnostic.reason);
    Object.assign(wrapped, { previewPrincipalDiagnostic: { failure, finalStage: diagnostic } });
    throw wrapped;
  }
}
