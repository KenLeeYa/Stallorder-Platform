import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {createHash} from 'node:crypto';

export function verifyWebReleasePlan(plan, current, now=Date.now()) {
  const policyBytes=readFileSync(new URL('./web-release-audit-exception.json',import.meta.url)),policy=JSON.parse(policyBytes);
  const policyHash=createHash('sha256').update(policyBytes).digest('hex');
  for (const receipt of [plan, current]) {
    if (receipt.status !== 'PASS' || receipt.scope !== 'WEB_KNOWN_NATIVE_DEPENDENCY_EXCLUSION'
      || receipt.npmVersion !== '11.16.0'
      || receipt.selector !== 'npm ci --workspace packages/contracts --include-workspace-root --include=dev'
      || !/^[a-f0-9]{64}$/.test(receipt.artifactSha256 ?? '')
      || typeof receipt.buildId !== 'string' || !receipt.buildId.trim()
      || receipt.runtimeLoaderSafety !== 'NOT_PROVEN' || receipt.deployment !== 'NOT_DEPLOYED'
      || !((receipt.selectedAuditStatus==='NON_PASS'&&receipt.auditDecision==='USER_ACCEPTED_EXACT_EXCEPTION')||(receipt.selectedAuditStatus==='PASS'&&receipt.auditDecision==='ZERO_VULNERABILITIES'))
      || receipt.auditExceptionPolicySha256!==policyHash) {
      throw Error('WEB_PLAN_SCOPE_INVALID');
    }
    if(receipt.auditDecision==='USER_ACCEPTED_EXACT_EXCEPTION'&&(!Number.isFinite(Date.parse(policy.expiresAt))||now>Date.parse(policy.expiresAt)))throw Error('WEB_PLAN_EXCEPTION_EXPIRED');
  }
  if(plan.auditDecision!==current.auditDecision||plan.selectedAuditStatus!==current.selectedAuditStatus)throw Error('WEB_PLAN_AUDIT_DECISION_MISMATCH');
  for (const key of ['head', 'tree', 'sourceSha256', 'lockSha256', 'installedGraphSha256', 'verifierSha256', 'auditExceptionPolicySha256']) {
    if (typeof plan[key] !== 'string' || !/^[a-f0-9]+$/.test(plan[key])
      || plan[key].length !== (key === 'head' || key === 'tree' ? 40 : 64)
      || plan[key] !== current[key]) throw Error('WEB_PLAN_BINDING_MISMATCH');
  }
  // Each build has its own validated artifact; random build IDs need not match.
  return { status: 'PASS', scope: plan.scope, head: plan.head, tree: plan.tree };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error('WEB_PLAN_ARGUMENTS_INVALID');
    console.log(JSON.stringify(verifyWebReleasePlan(...process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8'))))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
