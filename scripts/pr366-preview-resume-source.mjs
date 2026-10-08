import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceSnapshot } from './lib/web-release-dependency-audit.mjs';

export function assertResume(receipt, now = Date.now()) {
  if (receipt.resourceKey !== 'manual-37103994917' || receipt.branchName !== receipt.resourceKey
    || receipt.parent !== 'eyuctbnlvnbnivwasvqr' || receipt.team !== 'team_MMfsiG94K9Zy3e6w7Ccc9xY4'
    || receipt.project !== 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP' || receipt.gitBranch !== 'codex/integrated-production-20261002'
    || receipt.status !== 'CAPTURED' || receipt.recoverySource?.runId !== '37103994917'
    || receipt.recoverySource?.headSha !== '0b4e0d8c5967fed5540074c09062017d74370ca7'
    || receipt.branches?.length !== 1 || receipt.branches[0].id !== 'jwscaevupxhaolhfydtv' || receipt.branches[0].absent
    || receipt.deployments?.length !== 1 || receipt.deployments[0].id !== 'dpl_BrsgjRg4nnn2wZHXT5s8vCT1427e'
    || receipt.deployments[0].target !== 'preview' || receipt.deployments[0].absent
    || Date.parse(receipt.expiresAt) > Date.parse('2026-10-03T12:47:12.837Z')
    || !(Date.parse(receipt.expiresAt) > now + 95 * 60_000)
    || !(Date.parse('2026-10-03T12:14:35.283Z') > now + 65 * 60_000)) throw Error('RESUME_OWNER_OR_DEADLINE_DENIED');
}

export function assertEquivalent(original, candidate, supabaseUnchanged) {
  if (original.head !== '0b4e0d8c5967fed5540074c09062017d74370ca7'
    || original.tree !== '5274ea81dbfd1e8cec044d9e2091ba13c56d5c85'
    || original.sourceSha256 !== candidate.sourceSha256 || original.lockSha256 !== candidate.lockSha256
    || !supabaseUnchanged) throw Error('RESUME_RUNTIME_DRIFT');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receipt = JSON.parse(readFileSync('.preview-receipt/manual-resources.json', 'utf8'));
    assertResume(receipt);
    if (process.argv[2] === 'verify' && process.argv.length === 4) {
      const original = sourceSnapshot(resolve(process.argv[3])), candidate = sourceSnapshot(process.cwd());
      const comparison = execFileSync('git', ['diff', '--name-only', original.head, 'HEAD', '--', 'supabase'], { encoding: 'utf8' }).trim();
      assertEquivalent(original, candidate, comparison === '');
      const harness = Object.fromEntries(['qa-pr366-preview-ui.mjs', 'qa-pr366-preview-ui-supervised.mjs', 'qa-pr366-preview-db-fixtures.mjs', 'qa-pr366-preview-resume.sh', 'preview-harness-preflight.mjs', 'lib/catalog-preview-locators.cjs']
        .map(name => [name, createHash('sha256').update(readFileSync(`scripts/${name}`)).digest('hex')]));
      writeFileSync('.preview-receipt/runtime-equivalence.json', JSON.stringify({ status: 'RUNTIME_SOURCE_EQUIVALENT',
        original, candidate, supabaseUnchanged: true, harness,
        limitation: 'Full Git trees differ. Browser target remains the original deployment; only QA harness changes are overlaid.' }, null, 2));
    } else if (process.argv[2] !== 'prepare' || process.argv.length !== 3) throw Error('RESUME_ARGUMENTS_DENIED');
    console.log('RESUME_ORIGINAL_PAIR_VERIFIED');
  } catch (error) {
    console.error(/^RESUME_[A-Z_]+$/.test(error.message) ? error.message : 'RESUME_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}
