import { createHash } from "node:crypto";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VERCEL_PROJECT_PATTERN = /^prj_[A-Za-z0-9]+$/u;
const VERCEL_CNAME_PATTERN = /^(?:cname\.vercel-dns|[a-z0-9-]+\.vercel-dns-[0-9]+)\.com$/u;

export const DR_OPERATOR_ENTRY = Object.freeze({
  hostname: "dr.qidaigo.com",
  legacyHostname: "staging.qidaigo.com",
  projectName: "stallorder-dr",
  protection: "VERCEL_AUTHENTICATION_ALL",
});

export function stableJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("DR_ENTRY_PLAN_VALUE_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("DR_ENTRY_PLAN_VALUE_INVALID");
}

export function planDigest(planCore) {
  return createHash("sha256").update(stableJson(planCore), "utf8").digest("hex");
}

export function validateDrSupabaseBindings({
  expectedProjectRef,
  actualProjectRef,
  supabaseUrl,
  functionsUrl,
}) {
  if (!/^[a-z]{20}$/u.test(expectedProjectRef ?? "")) {
    throw new Error("DR_ENTRY_SUPABASE_PROJECT_REF_INVALID");
  }
  if (actualProjectRef !== expectedProjectRef) {
    throw new Error("DR_ENTRY_SUPABASE_PROJECT_REF_CHANGED_AFTER_PLAN");
  }
  const expectedBase = `https://${expectedProjectRef}.supabase.co`;
  if (supabaseUrl?.replace(/\/$/u, "") !== expectedBase) {
    throw new Error("DR_ENTRY_SUPABASE_URL_MISMATCH");
  }
  if (functionsUrl?.replace(/\/$/u, "") !== `${expectedBase}/functions/v1`) {
    throw new Error("DR_ENTRY_SUPABASE_FUNCTIONS_URL_MISMATCH");
  }
}

export function missingActiveEdgeFunctions(expectedNames, deployedFunctions) {
  const activeNames = new Set(deployedFunctions
    .filter((entry) => entry.status === "ACTIVE")
    .map((entry) => entry.slug ?? entry.name)
    .filter(Boolean));
  return [...expectedNames].filter((name) => !activeNames.has(name)).sort();
}

export function buildDrOperatorEntryPlan(input) {
  validateSource(input.source);
  validateDrRuntime(input.drRuntime);
  validateProviderState(input.providers);

  const targetProject = input.providers.vercel.targetProject;
  if (targetProject) {
    throw new Error("DR_VERCEL_PROJECT_ALREADY_EXISTS");
  }
  if (input.providers.vercel.drDomainBindings.length > 0) {
    throw new Error("DR_DOMAIN_ALREADY_BOUND");
  }
  if (input.providers.cloudflare.drRecords.length > 0) {
    throw new Error("DR_DNS_ALREADY_EXISTS");
  }

  const stagingDomain = input.providers.vercel.stagingDomain;
  const stagingRecord = input.providers.cloudflare.stagingRecord;
  if (!stagingDomain || stagingDomain.gitBranch !== "staging") {
    throw new Error("LEGACY_STAGING_VERCEL_STATE_INVALID");
  }
  if (!stagingRecord || stagingRecord.type !== "CNAME") {
    throw new Error("LEGACY_STAGING_DNS_STATE_INVALID");
  }

  const core = {
    schemaVersion: 1,
    operation: "CREATE_PROTECTED_DR_OPERATOR_ENTRY",
    changesRemoteState: false,
    source: input.source,
    target: {
      hostname: DR_OPERATOR_ENTRY.hostname,
      projectName: DR_OPERATOR_ENTRY.projectName,
      vercelTeamId: input.providers.vercel.teamId,
      sourceProjectId: input.providers.vercel.sourceProject.id,
      cloudflareZoneId: input.providers.cloudflare.zoneId,
      cnameTarget: input.providers.vercel.cnameTarget,
      dnsProxy: false,
      protection: DR_OPERATOR_ENTRY.protection,
      runtime: {
        backendTarget: "DR",
        authProjectCode: "DR",
        supabaseProjectRef: input.drRuntime.supabaseProjectRef,
        promotionEpoch: input.drRuntime.promotionEpoch,
        databaseRole: "READ_ONLY_STANDBY",
        writesEnabled: false,
        enforcementEnabled: true,
        operatorProbePath: "/api/health/dr/operator",
      },
    },
    before: {
      targetProject: null,
      drDomainBindings: [],
      drDnsRecords: [],
      legacyStaging: {
        vercel: stagingDomain,
        cloudflare: stagingRecord,
      },
      cloudflareAccess: input.providers.cloudflare.access,
    },
    applySteps: [
      "create an unlinked stallorder-dr Vercel project with Vercel Authentication on all deployments",
      "deploy the exact source commit with vercel.dr.json and DR-only runtime bindings without assigning a domain",
      "verify the generated deployment rejects unauthenticated access, the authenticated operator probe reports READY, and DR Auth, Storage and Edge Functions pass read-only checks",
      "bind dr.qidaigo.com to the DR project and create its DNS-only Cloudflare CNAME",
      "verify the custom domain remains protected and app.qidaigo.com remains healthy",
      "remove the stale staging.qidaigo.com Vercel binding and Cloudflare record",
    ],
    rollback: [
      "restore the recorded staging.qidaigo.com Vercel binding and Cloudflare CNAME if they were removed",
      "delete the newly created dr.qidaigo.com Cloudflare record and Vercel binding",
      "delete the newly created stallorder-dr Vercel project",
      "do not alter Primary or DR database writer state",
    ],
  };

  return {
    ...core,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    planDigest: planDigest(core),
  };
}

export function validateApprovedDrOperatorEntryPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("DR_ENTRY_PLAN_INVALID");
  }
  const core = { ...plan };
  const digest = core.planDigest;
  delete core.generatedAt;
  delete core.planDigest;
  if (!/^[0-9a-f]{64}$/u.test(digest ?? "")) {
    throw new Error("DR_ENTRY_PLAN_DIGEST_INVALID");
  }
  if (planDigest(core) !== digest) {
    throw new Error("DR_ENTRY_PLAN_DIGEST_MISMATCH");
  }
  if (plan.operation !== "CREATE_PROTECTED_DR_OPERATOR_ENTRY") {
    throw new Error("DR_ENTRY_PLAN_OPERATION_INVALID");
  }
  if (plan.changesRemoteState !== false) {
    throw new Error("DR_ENTRY_PLAN_MODE_INVALID");
  }
  return plan;
}

function validateSource(source) {
  if (!source || !SHA_PATTERN.test(source.commitSha ?? "")) {
    throw new Error("DR_ENTRY_SOURCE_COMMIT_INVALID");
  }
  for (const value of [source.treeSha, source.stagingTreeSha]) {
    if (!SHA_PATTERN.test(value ?? "")) throw new Error("DR_ENTRY_SOURCE_TREE_INVALID");
  }
  if (source.treeSha !== source.stagingTreeSha) {
    throw new Error("DR_ENTRY_STAGING_TREE_MISMATCH");
  }
}

function validateDrRuntime(runtime) {
  if (!runtime || runtime.backendCode !== "DR") {
    throw new Error("DR_ENTRY_BACKEND_IDENTITY_INVALID");
  }
  if (runtime.backendRole !== "READ_ONLY_STANDBY" || runtime.writesEnabled !== false) {
    throw new Error("DR_ENTRY_NOT_READ_ONLY_STANDBY");
  }
  if (runtime.enforcementEnabled !== true) {
    throw new Error("DR_ENTRY_WRITER_FENCE_DISABLED");
  }
  if (!Number.isSafeInteger(runtime.promotionEpoch) || runtime.promotionEpoch < 1) {
    throw new Error("DR_ENTRY_PROMOTION_EPOCH_INVALID");
  }
  if (!/^[a-z]{20}$/u.test(runtime.supabaseProjectRef ?? "")) {
    throw new Error("DR_ENTRY_SUPABASE_PROJECT_REF_INVALID");
  }
}

function validateProviderState(providers) {
  if (!providers?.vercel || !providers.cloudflare) {
    throw new Error("DR_ENTRY_PROVIDER_STATE_INVALID");
  }
  if (!/^team_[A-Za-z0-9]+$/u.test(providers.vercel.teamId ?? "")) {
    throw new Error("DR_ENTRY_VERCEL_TEAM_INVALID");
  }
  if (!VERCEL_PROJECT_PATTERN.test(providers.vercel.sourceProject?.id ?? "")) {
    throw new Error("DR_ENTRY_SOURCE_PROJECT_INVALID");
  }
  if (providers.vercel.sourceProject.name !== "stallorder-platform") {
    throw new Error("DR_ENTRY_SOURCE_PROJECT_INVALID");
  }
  if (!/^[a-f0-9]{32}$/u.test(providers.cloudflare.zoneId ?? "")) {
    throw new Error("DR_ENTRY_CLOUDFLARE_ZONE_INVALID");
  }
  if (!VERCEL_CNAME_PATTERN.test(providers.vercel.cnameTarget ?? "")) {
    throw new Error("DR_ENTRY_CNAME_TARGET_INVALID");
  }
  if (!VERCEL_CNAME_PATTERN.test(providers.vercel.legacyCnameTarget ?? "")) {
    throw new Error("LEGACY_STAGING_CNAME_TARGET_INVALID");
  }
  const stagingRecord = providers.cloudflare.stagingRecord;
  if (
    stagingRecord
    && (
      stagingRecord.content !== providers.vercel.legacyCnameTarget
      || stagingRecord.proxied !== false
    )
  ) {
    throw new Error("LEGACY_STAGING_DNS_TARGET_INVALID");
  }
}
