import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateArchiveContext,formatArchiveCapture} from './delivery-edge-recovery.capture.mjs';
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-evidence.yml@refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch',EDGE_RECOVERY_ARCHIVE_SCOPE:'PRIMARY_READ_ONLY_5'});
test('archive entry accepts only owner-dispatched protected main',()=>{assert.deepEqual(validateArchiveContext(env()),{controlCommit:'a'.repeat(40),runId:'12345',runAttempt:1});});
for(const [key,value] of Object.entries({GITHUB_ACTOR:'other',GITHUB_TRIGGERING_ACTOR:'other',GITHUB_REF:'refs/heads/staging',GITHUB_WORKFLOW_REF:'other',GITHUB_EVENT_NAME:'push',RUNNER_ENVIRONMENT:'self-hosted',GITHUB_RUN_ATTEMPT:'0',EDGE_RECOVERY_ARCHIVE_SCOPE:'all'}))test('archive entry refuses '+key,()=>{assert.throws(()=>validateArchiveContext({...env(),[key]:value}));});
test('log transport emits only complete hashed encrypted payload chunks',()=>{
 const sealed={ciphertext:'X'.repeat(40000),schema:'synthetic-encrypted-test'};
 const provenance=validateArchiveContext(env());const events=formatArchiveCapture({sealed,provenance,summary:{project:'eyuctbnlvnbnivwasvqr',functions:[]}});
 assert.equal(events[0].event,'edge-recovery-capture');const chunks=events.slice(1,-1);assert.equal(chunks.length,events[0].chunks);
 assert.deepEqual(chunks.map(c=>c.index),chunks.map((_,i)=>i));assert.ok(chunks.every(c=>c.data.length<=12000));
 const bytes=Buffer.from(chunks.map(c=>c.data).join(''),'base64');assert.deepEqual(JSON.parse(bytes),sealed);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),events[0].sha256);
 assert.equal(events.at(-1).sha256,events[0].sha256);assert.equal(events[0].releaseAuthorized,false);assert.equal(events[0].restoreVerified,false);
});
