import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { STAGING_TARGET, conversionApi, conversionDigest, conversionRequired, stagingOwnerPolicy } from "./dr-staging-conversion-plan.mjs";
import { sealBackup } from "./backup-dr-for-staging.mjs";

const PREFIX = `/accounts/${STAGING_TARGET.account}/access`;
const PRIVATE_PATH = "staging-conversion-private/access.json";

export function stagingAccessConfiguration({ owner, idpId, tokenId, sourceSha }) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  return { name: `StallOrder Staging ${sourceSha.slice(0, 12)}`, domain: STAGING_TARGET.host,
    type: "self_hosted", session_duration: "1h", auto_redirect_to_identity: true,
    allowed_idps: [idpId], policies: [
      { name: "Restricted Staging owner", precedence: 1, ...stagingOwnerPolicy(owner) },
      { name: "Temporary Staging acceptance", precedence: 2, decision: "non_identity",
        include: [{ service_token: { token_id: tokenId } }], require: [], exclude: [] },
    ] };
}

export function assertStagingAccessReadback(app, policies, expected) {
  assert.ok(app.id && /^[a-f0-9]{64}$/.test(app.aud) && app.domain === STAGING_TARGET.host
    && app.type === "self_hosted" && app.session_duration === "1h", "STAGING_ACCESS_READBACK_INVALID");
  assert.deepEqual(app.allowed_idps, expected.allowed_idps, "STAGING_ACCESS_IDP_CHANGED");
  assert.equal(policies.length, 2, "STAGING_ACCESS_POLICY_CHANGED");
  for (const policy of expected.policies) {
    const actual = policies.find((item) => item.name === policy.name);
    assert.ok(actual, "STAGING_ACCESS_POLICY_CHANGED");
    for (const key of ["decision", "include", "require", "exclude"]) {
      assert.deepEqual(actual[key] ?? [], policy[key], "STAGING_ACCESS_POLICY_CHANGED");
    }
  }
}

async function saveAccess(state) {
  await mkdir("staging-conversion-private", { recursive: true, mode: 0o700 });
  await mkdir("artifacts", { recursive: true });
  const bytes = Buffer.from(JSON.stringify(state));
  await writeFile(PRIVATE_PATH, bytes, { mode: 0o600 });
  // Only authenticated ciphertext and non-sensitive resource identities survive
  // the runner. The temporary token expires after one hour and is also removed.
  await writeFile("artifacts/staging-access-recovery.json.enc",
    sealBackup(bytes, conversionRequired("DR_BACKUP_ENCRYPTION_KEY")), { mode: 0o600 });
  await writeFile("artifacts/staging-access-entry.json", JSON.stringify({
    sourceSha: state.sourceSha, planDigest: state.planDigest, appId: state.appId,
    dnsId: state.dnsId, qaTokenId: state.qaTokenId, qaPolicyId: state.qaPolicyId,
    domainAttached: state.domainAttached ?? false, ready: state.ready ?? false,
  }, null, 2));
}

export async function prepareStagingAccess(plan, verifyPrimary) {
  const oldPolicies = await conversionApi("cloudflare", `${PREFIX}/apps/${STAGING_TARGET.oldAccessId}/policies`);
  assert.equal(oldPolicies.length, 1, "STAGING_OWNER_POLICY_CHANGED");
  const owner = stagingOwnerPolicy(oldPolicies[0]);
  assert.equal(conversionDigest(owner), plan.providerPrestate.sourcePolicyDigest, "STAGING_OWNER_POLICY_CHANGED");
  const state = { sourceSha: plan.sourceSha, planDigest: conversionDigest(plan) };
  const token = await conversionApi("cloudflare", `${PREFIX}/service_tokens`, { method: "POST",
    body: JSON.stringify({ name: `StallOrder Staging acceptance ${process.env.GITHUB_RUN_ID}`, duration: "1h" }) });
  assert.ok(token.id && token.client_id && token.client_secret, "STAGING_QA_TOKEN_INVALID");
  Object.assign(state, { qaTokenId: token.id, clientId: token.client_id, clientSecret: token.client_secret,
    tokenName: token.name, tokenExpiresAt: token.expires_at });
  await saveAccess(state);
  await verifyPrimary();
  state.expected = stagingAccessConfiguration({ owner, idpId: plan.providerPrestate.idpId,
    tokenId: token.id, sourceSha: plan.sourceSha });
  const app = await conversionApi("cloudflare", `${PREFIX}/apps`, { method: "POST", body: JSON.stringify(state.expected) });
  Object.assign(state, { appId: app.id, audience: app.aud, teamDomain: plan.providerPrestate.teamDomain });
  await saveAccess(state);
  const policies = await conversionApi("cloudflare", `${PREFIX}/apps/${app.id}/policies`);
  assertStagingAccessReadback(app, policies, state.expected);
  state.qaPolicyId = policies.find((item) => item.decision === "non_identity").id;
  state.ownerPolicyId = policies.find((item) => item.decision === "allow").id;
  await saveAccess(state);
  await verifyPrimary();
  // Prove DNS edit capability before removing any old data. Keep it proxied;
  // the existing origin denies this unknown host until the JWT-guarded Preview
  // is assigned. No unprotected Production alias is used for this entry.
  const dns = await conversionApi("cloudflare", `/zones/${STAGING_TARGET.zone}/dns_records`, {
    method: "POST", body: JSON.stringify({ type: "CNAME", name: STAGING_TARGET.host,
      content: "cname.vercel-dns.com", proxied: true, ttl: 1,
      comment: `Staging conversion ${plan.sourceSha}` }),
  });
  assert.ok(dns.id && dns.name === STAGING_TARGET.host && dns.proxied, "STAGING_DNS_READBACK_INVALID");
  state.dnsId = dns.id;
  await saveAccess(state);
  await verifyPrimary();
  const domain = await conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}/domains`, {
    method: "POST", body: JSON.stringify({ name: STAGING_TARGET.host, gitBranch: "staging" }),
  });
  assert.equal(domain.name, STAGING_TARGET.host, "STAGING_DOMAIN_READBACK_INVALID");
  state.domainAttached = true;
  await saveAccess(state);
  await verifyPrimary();
  state.ready = true;
  await saveAccess(state);
  return state;
}

export async function readStagingAccess(plan) {
  const state = JSON.parse(await readFile(PRIVATE_PATH, "utf8"));
  assert.ok(state.ready && state.planDigest === conversionDigest(plan) && state.sourceSha === plan.sourceSha,
    "STAGING_ACCESS_STATE_INVALID");
  const [app, policies, dns, domain] = await Promise.all([
    conversionApi("cloudflare", `${PREFIX}/apps/${state.appId}`),
    conversionApi("cloudflare", `${PREFIX}/apps/${state.appId}/policies`),
    conversionApi("cloudflare", `/zones/${STAGING_TARGET.zone}/dns_records/${state.dnsId}`),
    conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}/domains/${STAGING_TARGET.host}`),
  ]);
  assertStagingAccessReadback(app, policies, state.expected);
  assert.ok(dns.name === STAGING_TARGET.host && dns.type === "CNAME" && dns.content === "cname.vercel-dns.com"
    && domain.name === STAGING_TARGET.host && app.aud === state.audience, "STAGING_ENTRY_CHANGED");
  return state;
}

export async function removeStagingQaAccess(plan) {
  const state = JSON.parse(await readFile(PRIVATE_PATH, "utf8"));
  assert.ok(state.planDigest === conversionDigest(plan) && state.sourceSha === plan.sourceSha, "STAGING_ACCESS_STATE_INVALID");
  if (state.qaRemoved) return;
  const tokens = await conversionApi("cloudflare", `${PREFIX}/service_tokens?per_page=1000`);
  assert.ok(tokens.length < 1000, "STAGING_QA_TOKEN_CHANGED");
  const token = tokens.find((item) => item.id === state.qaTokenId);
  if (token) assert.equal(token.name, state.tokenName, "STAGING_QA_TOKEN_CHANGED");
  if (state.appId) {
    const policies = await conversionApi("cloudflare", `${PREFIX}/apps/${state.appId}/policies`);
    const temporary = policies.filter((item) => item.decision === "non_identity" && item.include?.length === 1
      && item.include[0].service_token?.token_id === state.qaTokenId);
    assert.ok(temporary.length <= 1 && policies.length === temporary.length + 1, "STAGING_QA_CLEANUP_INVALID");
    const owner = policies.find((item) => item.decision === "allow");
    assert.deepEqual(stagingOwnerPolicy(owner), stagingOwnerPolicy(state.expected.policies[0]), "STAGING_OWNER_POLICY_CHANGED");
    if (temporary.length) await conversionApi("cloudflare", `${PREFIX}/apps/${state.appId}/policies/${temporary[0].id}`, { method: "DELETE" });
    assert.equal((await conversionApi("cloudflare", `${PREFIX}/apps/${state.appId}/policies`)).length, 1, "STAGING_QA_CLEANUP_INVALID");
  }
  if (token) await conversionApi("cloudflare", `${PREFIX}/service_tokens/${state.qaTokenId}`, { method: "DELETE" });
  assert.ok(!(await conversionApi("cloudflare", `${PREFIX}/service_tokens?per_page=1000`))
    .some((item) => item.id === state.qaTokenId), "STAGING_QA_TOKEN_NOT_REMOVED");
  state.qaRemoved = true;
  await saveAccess(state);
}
