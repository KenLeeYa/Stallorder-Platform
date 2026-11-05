import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUnchangedExecution } from './delivery-admission.mjs';

const fixture = () => Object.fromEntries(['run', 'job', 'securityJob'].map((name, index) => [name, {
  id: index + 10, run_id: 10, head_sha: 'a'.repeat(40), run_attempt: 1,
  status: 'completed', conclusion: name === 'job' ? 'success' : 'failure',
  created_at: '2026-11-04T19:40:00Z', started_at: '2026-11-04T19:41:00Z', completed_at: '2026-11-04T20:00:00Z',
}]));
test('final readback retains the exact executions without requiring unrelated metadata equality', () => {
  const before = fixture(), after = structuredClone(before);
  after.run.display_title = 'unchanged execution metadata';
  assert.doesNotThrow(() => assertUnchangedExecution(before, after));
});
for (const name of ['run', 'job', 'securityJob']) {
  for (const key of ['id', 'run_id', 'head_sha', 'run_attempt', 'status', 'conclusion', 'created_at', 'started_at', 'completed_at']) {
    test(`rejects execution drift during log download: ${name}.${key}`, () => {
      const before = fixture(), after = structuredClone(before);
      after[name][key] = key === 'run_attempt' ? 2 : 'changed';
      assert.throws(() => assertUnchangedExecution(before, after));
    });
  }
}

import { safeGithubFailure } from './delivery-admission.mjs';
for(const [stderr,reason,http] of [
 ['read tcp: connection reset by peer','connection-reset',undefined],
 ['unexpected EOF','unexpected-eof',undefined],
 ['net/http: TLS handshake timeout','timeout',undefined],
 ['HTTP 403: Resource not accessible by integration','authorization','403'],
 ['HTTP 404: Not Found','http-error','404'],
 ['blocked by policy','authorization',undefined],
 ['write EPIPE','broken-pipe',undefined],
 ['failed secret https://example.test/?token=private','unclassified',undefined],
]) test('reports bounded GitHub diagnostics: '+reason+' '+(http??stderr.slice(0,8)),()=>{
 const result=safeGithubFailure({stderr,status:1});assert.equal(result.reason,reason);assert.equal(result.http,http);
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('https://'));
});

test('bounded diagnostic strips credentials and signed URLs',()=>{
 const r=safeGithubFailure({stderr:'download failed https://logs.example/path?sig=private Bearer secret-token ghp_abcdef1234567890 sbp_abcdef1234567890 '+ 'x'.repeat(1000)});
 assert.ok(r.diagnostic.length<=240); assert.ok(!/https:|private|secret-token|ghp_|sbp_/.test(r.diagnostic));
});

import { githubReadArguments } from './delivery-admission.mjs';
test('raw escape allowance is limited to authenticated job-log capture',()=>{
 assert.deepEqual(githubReadArguments('actions/jobs/126846074318/logs'),['api','--hostname','github.com','repos/KenLeeYa/Stallorder-Platform/actions/jobs/126846074318/logs','--allow-escape-sequences']);
 for(const path of ['actions/runs/1','contents/a?ref=abc','actions/jobs/1/logs?x=1']) assert.equal(githubReadArguments(path).includes('--allow-escape-sequences'),false);
});

import {validateAdmissionContext} from './delivery-admission.mjs';
const hosted=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/codex/primary-only-preparation',GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/delivery-candidate-admission.yml@refs/heads/codex/primary-only-preparation',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345'});
test('admits only the bound preparation or protected main evidence workflow',()=>{
 assert.equal(validateAdmissionContext(hosted()).releaseAuthorized,false);
 const e=hosted();e.GITHUB_REF='refs/heads/main';e.GITHUB_WORKFLOW_REF='KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-evidence.yml@refs/heads/main';
 assert.equal(validateAdmissionContext(e).releaseAuthorized,false);
 for(const patch of [{GITHUB_ACTOR:'other'},{GITHUB_TRIGGERING_ACTOR:'other'},{GITHUB_WORKFLOW_REF:'another'},{GITHUB_SHA:'bad'},{GITHUB_RUN_ID:'0'},{GITHUB_REF:'refs/heads/staging'},{RUNNER_ENVIRONMENT:'self-hosted'},{GITHUB_REPOSITORY:'other/repo'}]) assert.throws(()=>validateAdmissionContext({...e,...patch}));
});
