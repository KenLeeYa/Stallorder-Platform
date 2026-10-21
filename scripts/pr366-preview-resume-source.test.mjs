import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertEquivalent, assertResume } from './pr366-preview-resume-source.mjs';

const receipt = () => ({ resourceKey: 'manual-37103994917', branchName: 'manual-37103994917',
  parent: 'eyuctbnlvnbnivwasvqr', team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',
  gitBranch: 'codex/integrated-production-20261002', status: 'CAPTURED',
  recoverySource: { runId: '37103994917', headSha: '0b4e0d8c5967fed5540074c09062017d74370ca7' },
  branches: [{ id: 'jwscaevupxhaolhfydtv' }],
  deployments: [{ id: 'dpl_BrsgjRg4nnn2wZHXT5s8vCT1427e', target: 'preview' }],
  expiresAt: '2026-10-03T12:47:12.837Z' });
const now = Date.parse('2026-10-03T07:30:00Z');
describe('resume one original Preview pair', () => {
  it('accepts the original live pair before its unchanged deadline', () => expect(() => assertResume(receipt(), now)).not.toThrow());
  it('rejects replaced, absent, extra or Production resources', () => {
    for (const mutate of [r => r.branches[0].id = r.parent, r => r.deployments[0].absent = true,
      r => r.deployments.push({ ...r.deployments[0] }), r => r.deployments[0].target = 'production']) {
      const value = receipt(); mutate(value); expect(() => assertResume(value, now)).toThrow('RESUME_OWNER_OR_DEADLINE_DENIED');
    }
  });
  it('rejects extension and insufficient cleanup time', () => {
    const value = receipt(); value.expiresAt = '2026-10-03T13:00:00Z';
    expect(() => assertResume(value, now)).toThrow();
    expect(() => assertResume(receipt(), Date.parse('2026-10-03T11:30:00Z'))).toThrow();
  });
  it('permits only unchanged runtime, lock and Supabase sources', () => {
    const original = { head: receipt().recoverySource.headSha, tree: '5274ea81dbfd1e8cec044d9e2091ba13c56d5c85', sourceSha256: 'source', lockSha256: 'lock' };
    expect(() => assertEquivalent(original, { ...original, head: 'different-test-commit' }, true)).not.toThrow();
    expect(() => assertEquivalent(original, { ...original, sourceSha256: 'changed' }, true)).toThrow('RESUME_RUNTIME_DRIFT');
    expect(() => assertEquivalent(original, { ...original, lockSha256: 'changed' }, true)).toThrow('RESUME_RUNTIME_DRIFT');
    expect(() => assertEquivalent(original, original, false)).toThrow('RESUME_RUNTIME_DRIFT');
  });
  it('resume runner contains no resource creation or deployment command', () => {
    const script = readFileSync(new URL('./qa-pr366-preview-resume.sh', import.meta.url), 'utf8');
    expect(script).not.toMatch(/supabase\s+(?:branches\s+create|db\s+push)|vercel[^\n]*\bdeploy\b/);
    expect(script).toContain('trap resume_cleanup EXIT');
  });
});
