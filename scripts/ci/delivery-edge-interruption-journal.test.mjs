import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {buildPairedIntent,verifyInterruptedPairedJournal} from './delivery-edge-intent.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const base=Date.parse('2026-11-05T07:00:00Z'),at=n=>new Date(base+n*1000).toISOString();
const names=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
function fixture(failedPhase='replay',prefix=3) {
  const functions=EDGE_SLUGS.map((slug,i)=>{const wire=Buffer.from('EZBR-before-'+slug),digest=hash(wire);return {
    slug,wireSha256:digest,wireBase64:wire.toString('base64'),metadata:{id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),
      slug,status:'ACTIVE',version:10,verify_jwt:false,sha256:digest,entrypoint_path:'file:///index.ts',import_map_path:'file:///deno.json'}};});
  const snapshot={schema:'stallorder-paired-edge-preimage/v2',project:'teunnvfakbfzmodajqjz',controlCommit:'a'.repeat(40),
    runId:'1234',runAttempt:1,archiveSha256:'b'.repeat(64),startedAt:at(0),finishedAt:at(1),functions,
    replayTargets:functions.map(r=>({slug:r.slug,wireSha256:hash('EZBR-replay-'+r.slug),entrypoint_path:'file:///index.ts',import_map_path:'file:///deno.json',import_map:null})),
    usageFixtures:[createUsageFixture('1234'),createUsageFixture('1234')],releaseAuthorized:false};
  const repo={full_name:'KenLeeYa/Stallorder-Platform',id:1298874780,private:false,fork:false};
  const run={id:1234,workflow_id:90,run_number:1,run_attempt:1,head_sha:snapshot.controlCommit,head_branch:'main',
    event:'workflow_dispatch',path:'.github/workflows/production-delivery-edge-rehearsal.yml',repository:repo,head_repository:repo,
    actor:{login:'KenLeeYa'},triggering_actor:{login:'KenLeeYa'},status:'completed',conclusion:failedPhase?'failure':'success',created_at:at(0)};
  const failIndex=failedPhase?names.indexOf(failedPhase):8;
  const jobs=names.map((name,i)=>({id:100+i,name,run_id:1234,run_attempt:1,head_sha:snapshot.controlCommit,status:'completed',
    conclusion:i<failIndex?'success':i===failIndex?'failure':'skipped',labels:i<=failIndex?['ubuntu-24.04']:[],
    runner_name:i<=failIndex?'GitHub Actions 1':null,started_at:at(i*10),completed_at:at(i*10+9),
    steps:i<=failIndex?[
      {number:1,name:'Require current protected control and identical verified staging tree',status:'completed',conclusion:'success',started_at:at(i*10),completed_at:at(i*10+1)},
      {number:2,name:name.endsWith('-intent')?'Persist immutable paired Edge mutation intent':'Apply exact paired Edge phase once and verify each postimage',
        status:'completed',conclusion:i===failIndex?'failure':'success',started_at:at(i*10+1),completed_at:at(i*10+8)}]:[]}));
  const snapshotSha256='c'.repeat(64),logs={},events={};
  const plan=phase=>buildPairedIntent({snapshot,snapshotSha256,phase});
  for(const phase of ['replay','restore']) {
    const intent=jobs.find(j=>j.name===phase+'-intent'),writer=jobs.find(j=>j.name===phase),p=plan(phase);
    events[intent.id]=[{event:'paired-edge-mutation-intent',plan:p,planSha256:hash(JSON.stringify(p))}];
    events[writer.id]=p.operations.flatMap(op=>[
      {event:'paired-edge-operation-started',operationId:op.operationId,phase,slug:op.slug,expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
      {event:'paired-edge-operation-verified',operationId:op.operationId,phase,slug:op.slug,version:op.resultVersion,wireSha256:op.targetSource.wireSha256}]);
    if(writer.conclusion==='success')events[writer.id].push({event:'paired-edge-phase-complete',receipt:{schema:'stallorder-paired-edge-phase/v1',
      project:snapshot.project,controlCommit:snapshot.controlCommit,runId:snapshot.runId,runAttempt:1,phase,planSha256:hash(JSON.stringify(p)),
      attempted:EDGE_SLUGS,verified:EDGE_SLUGS,complete:true,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false}});
    else events[writer.id]=events[writer.id].slice(0,prefix);
  }
  const refresh=()=>{for(const job of jobs)if(job.conclusion!=='skipped')logs[job.id]=(events[job.id]??[]).map(e=>at(names.indexOf(job.name)*10+2).replace('Z','0000Z')+' '+JSON.stringify(e)).join('\n')||'no operation events';};
  refresh();return {snapshot,snapshotSha256,expectedWorkflowId:90,run,jobs,logs,events,refresh,now:base+7*3600000};
}
test('partial terminal replay retains uncertain started operation and never grants restoration',()=>{
  const x=fixture(),out=verifyInterruptedPairedJournal(x);
  assert.deepEqual(out.phases.replay.started,EDGE_SLUGS.slice(0,2));
  assert.deepEqual(out.phases.replay.verified,EDGE_SLUGS.slice(0,1));
  assert.equal(out.phases.replay.mayHaveWritten,true);assert.equal(out.phases.restore.mayHaveWritten,false);
  assert.equal(out.requiresRecoveryHistory,true);assert.equal(out.originVerified,false);assert.equal(out.mutationAuthorized,false);
});
test('empty hard-kill log never proves a started writer made no remote request',()=>{
  const x=fixture('replay',0),out=verifyInterruptedPairedJournal(x);
  assert.equal(out.phases.replay.mayHaveWritten,true);assert.deepEqual(out.phases.replay.started,[]);
});
test('failed restore stays potentially in flight even without operation log records',()=>{
  const x=fixture('restore',0),out=verifyInterruptedPairedJournal(x);
  assert.equal(out.phases.restore.mayHaveWritten,true);assert.equal(out.phases.restore.complete,false);
});
test('all writer completions do not imply cleanup or release qualification',()=>{
  const out=verifyInterruptedPairedJournal(fixture(null));
  assert.equal(out.phases.replay.complete,true);assert.equal(out.phases.restore.complete,true);
  assert.equal(out.cleanupVerified,false);assert.equal(out.productQualified,false);assert.equal(out.releaseAuthorized,false);
});
for(const [label,change] of [
  ['active run',x=>{x.run.status='in_progress';}],
  ['foreign workflow pin',x=>{x.expectedWorkflowId=91;}],
  ['repeat original run',x=>{x.run.run_number=2;}],
  ['unlisted stage',x=>{x.jobs.pop();}],
  ['writer before intent ends',x=>{x.jobs[2].started_at=at(15);}],
  ['writer after failed intent',x=>{x.jobs[1].conclusion='failure';}],
  ['writer after skipped intent',x=>{x.jobs[1].conclusion='skipped';}],
  ['wrong intent digest',x=>{x.events[101][0].planSha256='0'.repeat(64);x.refresh();}],
  ['missing intent event',x=>{x.events[101]=[];x.refresh();}],
  ['duplicate intent event',x=>{x.events[101].push(x.events[101][0]);x.refresh();}],
  ['operation reordered',x=>{x.events[102].reverse();x.refresh();}],
  ['duplicate operation',x=>{x.events[102].push(x.events[102][2]);x.refresh();}],
  ['unknown operation',x=>{x.events[102].push({event:'paired-edge-operation-unknown'});x.refresh();}],
  ['wrong postimage digest',x=>{x.events[102][1].wireSha256='0'.repeat(64);x.refresh();}],
  ['wrong operation identity',x=>{x.events[102][0].operationId='0'.repeat(64);x.refresh();}],
  ['missing source guard',x=>{x.jobs[2].steps.shift();}],
  ['events before apply step',x=>{x.logs[102]=x.logs[102].replaceAll('07:00:22','07:00:20');}],
  ['events after apply step',x=>{x.logs[102]=x.logs[102].replaceAll('07:00:22','07:00:29');}],
  ['unfinished successful writer log',x=>{x.jobs[2].conclusion='success';}],
])test('terminal journal refuses '+label,()=>{const x=fixture();change(x);assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('JSON-escaped duplicate operations remain visible to the parser',()=>{
  const x=fixture();x.logs[102]+='\n'+x.logs[102].split('\n')[0].replace('paired-edge','paired'+String.fromCharCode(92)+'u002dedge');
  assert.throws(()=>verifyInterruptedPairedJournal(x));
});
test('a full success event does not erase a failed writer job',()=>{
  const x=fixture(null);x.jobs[5].conclusion='failure';x.run.conclusion='failure';
  for(let i=6;i<8;i++){x.jobs[i].conclusion='skipped';x.jobs[i].steps=[];x.jobs[i].labels=[];x.jobs[i].runner_name=null;}
  const out=verifyInterruptedPairedJournal(x);
  assert.equal(out.phases.restore.complete,false);assert.equal(out.phases.restore.mayHaveWritten,true);
});
test('actual incomplete phase receipt followed by generic entry failure stays incomplete',()=>{
  const x=fixture();x.events[102].push({event:'paired-edge-rehearsal-incomplete',schema:'stallorder-paired-edge-phase/v1',phase:'replay',
    attempted:EDGE_SLUGS.slice(0,2),verified:EDGE_SLUGS.slice(0,1),complete:false,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false},
  {event:'paired-edge-entry-failed',releaseAuthorized:false});x.refresh();
  const out=verifyInterruptedPairedJournal(x);assert.equal(out.phases.replay.complete,false);assert.equal(out.phases.replay.mayHaveWritten,true);
});
for(const phase of ['replay-intent','replay'])test('successful job cannot hide failed '+phase+' step',()=>{
  const x=fixture(null);x.jobs.find(job=>job.name===phase).steps[1].conclusion='failure';
  assert.throws(()=>verifyInterruptedPairedJournal(x));
});

test('native skipped labels and scheduling timestamps do not imply a writer ran',()=>{
 const x=fixture();for(const j of x.jobs)if(j.conclusion==='skipped')Object.assign(j,{labels:['ubuntu-24.04'],runner_id:null,runner_group_id:null,runner_group_name:null,started_at:at(30),completed_at:at(29)});
 const out=verifyInterruptedPairedJournal(x);assert.equal(out.phases.restore.mayHaveWritten,false);
});

test('skipped job rejects assigned runner id',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.runner_id=42;assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects assigned group id',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.runner_group_id=1;assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects runner name',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.runner_name='GitHub Actions 9';assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects group name',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.runner_group_name='Default';assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects execution steps',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.steps=[{name:'unexpected'}];assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects foreign configured runner',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.labels=['self-hosted'];assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects extra configured runner',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.labels=['ubuntu-24.04','self-hosted'];assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects missing scheduling time',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.started_at=null;j.completed_at='2026-11-05T10:00:01Z';assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects pre-run scheduling time',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.started_at='2026-11-04T10:00:00Z';j.completed_at=j.started_at;assert.throws(()=>verifyInterruptedPairedJournal(x));});
test('skipped job rejects future scheduling time',()=>{const x=fixture();const j=x.jobs.find(j=>j.conclusion==='skipped');j.started_at='2026-11-06T10:00:00Z';j.completed_at=j.started_at;assert.throws(()=>verifyInterruptedPairedJournal(x));});

for(const id of [undefined,'7',0,-1,1.5])test('skipped job rejects invalid job id '+String(id),()=>{const x=fixture();x.jobs.find(j=>j.name==='restore').id=id;assert.throws(()=>verifyInterruptedPairedJournal(x));});
