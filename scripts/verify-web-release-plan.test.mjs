import { expect, test } from 'vitest';
import { verifyWebReleasePlan as validatePlan } from './verify-web-release-plan.mjs';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const verifyWebReleasePlan=(plan,current,now=Date.parse('2026-10-20T10:00:00+08:00'))=>validatePlan(plan,current,now);
const policyExpiry=Date.parse(JSON.parse(readFileSync(new URL('./web-release-audit-exception.json',import.meta.url))).expiresAt);
const policyHash=createHash('sha256').update(readFileSync(new URL('./web-release-audit-exception.json',import.meta.url))).digest('hex');
const policy=JSON.parse(readFileSync(new URL('./web-release-audit-exception.json',import.meta.url)));
const receipt = (buildId='fresh-build') => {const r={ status: 'PASS', scope: 'WEB_KNOWN_NATIVE_DEPENDENCY_EXCLUSION', npmVersion: '11.16.0',
  selector: 'npm ci --workspace packages/contracts --include-workspace-root --include=dev',
  head: 'a'.repeat(40), tree: 'b'.repeat(40), sourceSha256: 'c'.repeat(64), lockSha256: policy.lockBytesSha256,
  installedGraphSha256: 'e'.repeat(64), verifierSha256: 'f'.repeat(64), artifactSha256: '1'.repeat(64),
  buildId, runtimeLoaderSafety: 'NOT_PROVEN', deployment: 'NOT_DEPLOYED', auditExceptionPolicySha256:policyHash, selectedAuditStatus:'NON_PASS',auditDecision:'USER_ACCEPTED_EXACT_EXCEPTION' };
  r.exceptionActivation={...r,status:'ACTIVATED',policySha256:policyHash,sbomSha256:'2'.repeat(64),auditSha256:'3'.repeat(64),advisoryRuntimeExclusion:{status:'PASS',scope:'REVIEWED_SOURCE_LITERAL_IMPORTS_AND_NFT_PACKAGE_CLOSURE',traces:1},lint:{status:'PASS',logSha256:'4'.repeat(64),configSha256:policy.lintConfigSha256,rootDir:'UNSET',ruleEnabled:true},isolation:{platform:'linux',ci:true,githubHosted:true,workspaceMatches:true,cleanCheckout:true,loopbackServices:true,noReleaseCredentials:true,runId:'123',runAttempt:'1',job:'verify',sha:r.head}};return r;};
test('binds source and installation while allowing separately validated build IDs', () => {
  expect(verifyWebReleasePlan(receipt('plan'),receipt('apply')).status).toBe('PASS');
});
test('rejects missing activation and a stale activation after a new commit',()=>{const r=receipt();delete r.exceptionActivation;expect(()=>verifyWebReleasePlan(r,r)).toThrow('ACTIVATION_REQUIRED');const stale={...receipt(),head:'0'.repeat(40)};expect(()=>verifyWebReleasePlan(stale,stale)).toThrow('BINDING_MISMATCH');});
test('rejects policy drift even when both receipts agree and expiry',()=>{const changed={...receipt(),auditExceptionPolicySha256:'0'.repeat(64)};expect(()=>verifyWebReleasePlan(changed,changed)).toThrow('SCOPE_INVALID');expect(()=>verifyWebReleasePlan(receipt(),receipt(),policyExpiry+1)).toThrow('EXPIRED');});
test('clean audit remains valid after exception expires but cannot silently replace approved disposition',()=>{const clean={...receipt(),selectedAuditStatus:'PASS',auditDecision:'ZERO_VULNERABILITIES'};expect(verifyWebReleasePlan(clean,clean,policyExpiry+1)).toMatchObject({status:'PASS'});expect(()=>verifyWebReleasePlan(receipt(),clean)).toThrow('DECISION_MISMATCH');});
test.each(['head', 'tree', 'sourceSha256', 'lockSha256', 'installedGraphSha256', 'verifierSha256'])('rejects changed %s', key => {
  expect(() => verifyWebReleasePlan(receipt(), { ...receipt(), [key]: '0'.repeat(receipt()[key].length) })).toThrow('BINDING_MISMATCH');
});
test.each(['status', 'scope', 'npmVersion', 'selector'])('rejects invalid %s', key => {
  expect(() => verifyWebReleasePlan(receipt(), { ...receipt(), [key]: 'INVALID' })).toThrow('SCOPE_INVALID');
});
test('rejects missing or malformed fingerprints', () => {
  expect(() => verifyWebReleasePlan({ ...receipt(), sourceSha256: undefined }, receipt())).toThrow('BINDING_MISMATCH');
});
test.each(['artifactSha256', 'buildId', 'runtimeLoaderSafety', 'deployment'])('rejects missing artifact scope evidence %s', key => {
  expect(() => verifyWebReleasePlan(receipt(), { ...receipt(), [key]: undefined })).toThrow('SCOPE_INVALID');
});
