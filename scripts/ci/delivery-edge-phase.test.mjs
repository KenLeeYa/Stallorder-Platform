import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';
import {executeDurableEdgePhase} from './delivery-edge-rehearsal.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(phase='replay') {
 const record=(slug,label,i)=>{const wire=Buffer.from('EZBRsynthetic-'+label+slug),h=sha(wire);
 return {slug,wireBase64:wire.toString('base64'),wireSha256:h,metadata:{id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),
 slug,name:slug,version:10,status:'ACTIVE',verify_jwt:false,sha256:h,entrypoint_path:'file:///source/'+slug+'/index.ts',
 import_map_path:'file:///source/deno.json',import_map:true,unknown_config:{retained:true}}};};
 const before=EDGE_SLUGS.map((s,i)=>record(s,'before',i)),archive={schema:'stallorder-delivery-edge-recovery/v1',
 project:'eyuctbnlvnbnivwasvqr',releaseAuthorized:false,restoreVerified:false,functions:EDGE_SLUGS.map((s,i)=>record(s,'archive',i+10))};
 const snapshot={schema:'stallorder-paired-edge-preimage/v2',project:'teunnvfakbfzmodajqjz',controlCommit:'a'.repeat(40),
 runId:'123',runAttempt:1,archiveSha256:'b'.repeat(64),startedAt:'2026-11-05T10:00:00.000Z',finishedAt:'2026-11-05T10:00:01.000Z',
 functions:before,replayTargets:archive.functions.map(r=>({slug:r.slug,wireSha256:r.wireSha256,entrypoint_path:r.metadata.entrypoint_path,
 import_map_path:r.metadata.import_map_path,import_map:true})),usageFixtures:[createUsageFixture('123'),createUsageFixture('123')],releaseAuthorized:false};
 const state=new Map(before.map(r=>[r.slug,structuredClone(r)])),calls=[];
 const write=({record:r})=>{const prev=state.get(r.slug),after=structuredClone(r);after.metadata={...prev.metadata,version:prev.metadata.version+1,
 sha256:r.wireSha256,entrypoint_path:r.metadata.entrypoint_path,import_map_path:r.metadata.import_map_path,import_map:r.metadata.import_map};state.set(r.slug,after);};
 if(phase==='restore') for(const r of archive.functions)write({record:r});
 const x={snapshot,snapshotSha256:'c'.repeat(64),archive,phase,state,calls,
 read:async({project,slug})=>{assert.equal(project,snapshot.project);calls.push({read:slug});return structuredClone(state.get(slug));},
 apply:async args=>{assert.equal(args.project,snapshot.project);calls.push({apply:args.record.slug});write(args);},
 emit:event=>calls.push({event})};
 x.intent=buildPairedIntent(x);return x;
}
test('phase verifies all preimages then writes each literal function once and reads it back',async()=>{
 for(const phase of ['replay','restore']) {const f=fixture(phase);const result=await executeDurableEdgePhase(f);
 assert.equal(result.phase,phase);assert.deepEqual(result.verified,EDGE_SLUGS);assert.equal(result.releaseAuthorized,false);
 assert.equal(result.cleanupVerified,false);assert.equal(result.productionRecoveryVerified,false);
 assert.deepEqual(f.calls.slice(0,5).map(x=>x.read),EDGE_SLUGS);assert.equal(f.calls.filter(x=>x.apply).length,5);
 for(const r of f.state.values())assert.equal(r.metadata.version,phase==='restore'?12:11);}
});
test('a changed fifth preimage prevents the first write',async()=>{const f=fixture();f.state.get(EDGE_SLUGS[4]).metadata.unknown_config={foreign:true};
 await assert.rejects(executeDurableEdgePhase(f));assert.equal(f.calls.filter(x=>x.apply).length,0);});
test('timeout never retries or implicitly restores and preserves attempted versus verified',async()=>{const f=fixture();let count=0;
 f.apply=async()=>{count++;throw Error('synthetic timeout with private detail');};
 await assert.rejects(executeDurableEdgePhase(f),error=>{assert.equal(error.message,'EDGE_DURABLE_PHASE_INCOMPLETE');
 assert.deepEqual(error.receipt.attempted,[EDGE_SLUGS[0]]);assert.deepEqual(error.receipt.verified,[]);return true;});assert.equal(count,1);});
test('a rejected pre-write intent event prevents provider mutation',async()=>{const f=fixture();f.emit=()=>{throw Error('event failure');};
 await assert.rejects(executeDurableEdgePhase(f));assert.equal(f.calls.filter(x=>x.apply).length,0);});
test('foreign state after preflight stops before a later write',async()=>{const f=fixture(),oldApply=f.apply;
 f.apply=async args=>{await oldApply(args);f.state.get(EDGE_SLUGS[1]).metadata.version++;};
 await assert.rejects(executeDurableEdgePhase(f));assert.equal(f.calls.filter(x=>x.apply).length,1);});
test('unknown postimage stops without another mutation',async()=>{const f=fixture(),oldApply=f.apply;
 f.apply=async args=>{await oldApply(args);f.state.get(args.record.slug).metadata.version++;};
 await assert.rejects(executeDurableEdgePhase(f));assert.equal(f.calls.filter(x=>x.apply).length,1);});
for(const [label,change] of [
 ['wrong intent phase',f=>{f.intent.phase='restore';}],
 ['modified target digest',f=>{f.intent.operations[0].targetSource.wireSha256='d'.repeat(64);}],
 ['unbound archived bytes',f=>{f.archive.functions[0].wireBase64=Buffer.from('EZBRforeign').toString('base64');}],
])test('refuses '+label+' before mutation',async()=>{const f=fixture();change(f);await assert.rejects(executeDurableEdgePhase(f));assert.equal(f.calls.filter(x=>x.apply).length,0);});
for(const version of [10,12,13])test('restore refuses unresolved or already-consumed version '+version,async()=>{
 const f=fixture('restore');f.state.get(EDGE_SLUGS[0]).metadata.version=version;await assert.rejects(executeDurableEdgePhase(f));
 assert.equal(f.calls.filter(x=>x.apply).length,0);
});

test('an awaited intent event cannot hide drift before PATCH',async()=>{
 const f=fixture();f.emit=async event=>{if(event.event==='paired-edge-operation-started')f.state.get(event.slug).metadata.version++;};
 await assert.rejects(executeDurableEdgePhase(f));assert.equal(f.calls.filter(x=>x.apply).length,0);
});
test('invalid phase diagnostics do not echo untrusted input',async()=>{
 const f=fixture();f.phase='synthetic-private-input';
 await assert.rejects(executeDurableEdgePhase(f),error=>{assert.equal(error.receipt.phase,null);return true;});
});

for(const phase of ['replay','restore'])test('adapter cannot replace approved '+phase+' bytes through its argument',async()=>{
 const f=fixture(phase),originalApply=f.apply;
 f.apply=async args=>{const wire=Buffer.from('EZBRunapproved-adapter-content');args.record.wireBase64=wire.toString('base64');
 args.record.wireSha256=sha(wire);args.record.metadata.sha256=sha(wire);await originalApply(args);};
 await assert.rejects(executeDurableEdgePhase(f),error=>{assert.equal(error.message,'EDGE_DURABLE_PHASE_INCOMPLETE');
 assert.deepEqual(error.receipt.attempted,[EDGE_SLUGS[0]]);assert.deepEqual(error.receipt.verified,[]);return true;});
 assert.equal(f.calls.filter(x=>x.apply).length,1);
});
