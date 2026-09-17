import { planDigest, primaryVercelStateMatches, stableJson } from "./dr-operator-entry.mjs";

export function buildDrOperatorUpdatePlan({ source, state, runtime }) {
  if (!/^[a-f0-9]{40}$/u.test(source.commitSha ?? "")
    || !/^[a-f0-9]{40}$/u.test(source.treeSha ?? "")
    || source.treeSha !== source.stagingTreeSha) throw new Error("DR_UPDATE_SOURCE_INVALID");
  if (state.primary.healthStatus !== 200
    || state.primary.hostname !== "app.qidaigo.com"
    || state.primary.deployment.backendTarget === "DR"
    || state.primary.alias.projectId !== state.primary.deployment.projectId
    || state.primary.alias.deploymentId !== state.primary.deployment.id
    || state.primary.deployment.readyState !== "READY") throw new Error("DR_UPDATE_PRIMARY_INVALID");
  if (state.project.id === state.primary.alias.projectId
    || state.project.name !== "stallorder-dr"
    || state.project.protection !== "all_except_custom_domains"
    || state.alias.hostname !== "dr.qidaigo.com"
    || state.alias.projectId !== state.project.id
    || state.alias.deploymentId !== state.deployment.id
    || state.deployment.projectId !== state.project.id
    || state.deployment.backendTarget !== "DR"
    || state.deployment.readyState !== "READY"
    || stableJson(state.customDomains) !== stableJson(["dr.qidaigo.com"])) throw new Error("DR_UPDATE_TARGET_INVALID");
  if (runtime.backendCode !== "DR" || runtime.backendRole !== "READ_ONLY_STANDBY"
    || runtime.writesEnabled !== false || runtime.enforcementEnabled !== true
    || !Number.isSafeInteger(runtime.promotionEpoch) || runtime.promotionEpoch < 1
    || !/^[a-z]{20}$/u.test(runtime.supabaseProjectRef ?? "")) throw new Error("DR_UPDATE_RUNTIME_INVALID");
  const policy = state.access.policy;
  if (state.access.domain !== "dr.qidaigo.com" || state.access.type !== "self_hosted"
    || !/^[A-Za-z0-9_-]{16,256}$/u.test(state.access.audience ?? "")
    || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/u.test(state.access.teamDomain ?? "")
    || policy.decision !== "allow"
    || stableJson(policy.include) !== stableJson([{ cloudflare_account_member: { account_id: state.access.accountId } }])
    || policy.exclude.length !== 0
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(state.operatorEmail ?? "")) throw new Error("DR_UPDATE_ACCESS_INVALID");
  const requiredOperator = [{ email: { email: state.operatorEmail } }];
  if (policy.require.length && stableJson(policy.require) !== stableJson(requiredOperator)) throw new Error("DR_UPDATE_POLICY_REVIEW_REQUIRED");
  const core = {
    schemaVersion: 1, operation: "UPDATE_PROTECTED_DR_OPERATOR_ENTRY", source,
    before: state,
    target: {
      hostname: "dr.qidaigo.com", projectName: "stallorder-dr", projectId: state.project.id,
      runtime: { supabaseProjectRef: runtime.supabaseProjectRef, promotionEpoch: runtime.promotionEpoch },
      cloudflareAccess: { teamDomain: state.access.teamDomain },
      policy: { ...policy, name: "Allow designated DR operator", require: requiredOperator },
    },
  };
  return { ...core, generatedAt: new Date().toISOString(), planDigest: planDigest(core) };
}

export function validateDrOperatorUpdatePlan(plan) {
  const { generatedAt, planDigest: digest, ...core } = plan;
  if (core.operation !== "UPDATE_PROTECTED_DR_OPERATOR_ENTRY" || core.schemaVersion !== 1
    || planDigest(core) !== digest) throw new Error("DR_UPDATE_PLAN_INVALID");
  const age = Date.now() - Date.parse(generatedAt);
  if (!Number.isFinite(age) || age < -300_000 || age > 86_400_000) throw new Error("DR_UPDATE_PLAN_EXPIRED");
  return plan;
}

// Only resources changed by this exact update may be restored. Never delete a project or DNS record.
export async function applyDrOperatorUpdate(plan, ops) {
  let candidate;
  try {
    candidate = await ops.deploy();
    await ops.assertUnchanged();
    await ops.verifyCandidate(candidate);
    await ops.writePolicy(plan.target.policy);
    await ops.verifyPolicy(plan.target.policy);
    await ops.assertPrimary();
    await ops.promote(candidate);
    await ops.verifyLive(candidate);
    await ops.assertPrimary();
    return { completed: true, deploymentUrl: candidate };
  } catch (error) {
    const current = await ops.readState();
    if (!primaryVercelStateMatches(plan.before.primary, current.primary)) throw new Error("DR_UPDATE_PRIMARY_CONCURRENT_CHANGE");
    if (candidate && current.alias.deploymentUrl === new URL(candidate).hostname) {
      await ops.restoreDeployment(plan.before.deployment);
    } else if (current.alias.deploymentId !== plan.before.alias.deploymentId) {
      throw new Error("DR_UPDATE_CONCURRENT_DEPLOYMENT");
    }
    if (stableJson(current.access.policy) === stableJson(plan.target.policy)) {
      await ops.writePolicy(plan.before.access.policy);
    } else if (stableJson(current.access.policy) !== stableJson(plan.before.access.policy)) {
      throw new Error("DR_UPDATE_CONCURRENT_POLICY");
    }
    await ops.verifyRestored();
    throw error;
  }
}
