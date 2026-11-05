import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';
import {runPairedStage} from './delivery-edge-rehearsal-entry.mjs';
import {randomUUID} from 'node:crypto';
import {createRatePeriodLedger,recordRatePeriods,verifyRateExpiry} from './delivery-edge-rate-expiry.mjs';
import {decodeIncompleteUsageEvidence} from './delivery-edge-usage-evidence.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(phase){
 const records=prefix=>EDGE_SLUGS.map((slug,i)=>{const b=Buffer.from('EZBR-'+prefix+'-'+slug),h=sha(b);return {slug,wireSha256:h,wireBase64:b.toString('base64'),metadata:{id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),slug,status:'ACTIVE',version:10,verify_jwt:false,sha256:h,entrypoint_path:'file:///index.ts',import_map_path:'file:///deno.json'}};});
 const before=records('candidate'),archive={schema:'stallorder-delivery-edge-recovery/v1',project:'eyuctbnlvnbnivwasvqr',restoreVerified:false,releaseAuthorized:false,functions:records('archived')};
 const snapshot={schema:'stallorder-paired-edge-preimage/v2',project:'teunnvfakbfzmodajqjz',controlCommit:'a'.repeat(40),runId:'123',runAttempt:1,archiveSha256:'b'.repeat(64),startedAt:'2026-11-05T12:00:00.000Z',finishedAt:'2026-11-05T12:00:01.000Z',functions:before,
  replayTargets:archive.functions.map(r=>({slug:r.slug,wireSha256:r.wireSha256,entrypoint_path:r.metadata.entrypoint_path,import_map_path:r.metadata.import_map_path,import_map:null})),usageFixtures:[createUsageFixture('123'),createUsageFixture('123')],releaseAuthorized:false};
 const snapshotSha256='c'.repeat(64),calls=[],events=[];
 const state=new Map((phase==='replay'||phase==='replay-intent'?before:archive.functions).map(r=>[r.slug,structuredClone(r)]));
 if(phase!=='replay'&&phase!=='replay-intent')for(const r of state.values())r.metadata.version=11;
 const input={phase,snapshot,snapshotSha256,archive,
  read:async({slug})=>{calls.push('read:'+slug);return structuredClone(state.get(slug));},
  apply:async({record})=>{calls.push('apply:'+record.slug);const version=state.get(record.slug).metadata.version+1;state.set(record.slug,{...structuredClone(record),metadata:{...record.metadata,version}});},
  emit:async event=>events.push(event),
  loadIntent:async p=>{calls.push('intent:'+p);return {originVerified:true,lineageVerified:true,planSha256:sha(JSON.stringify(buildPairedIntent({snapshot,snapshotSha256,phase:p})))};},
  loadPhase:async p=>{calls.push('phase:'+p);return {originVerified:true,phaseComplete:true};},
  loadUsage:async p=>{calls.push('usage:'+p);return {originVerified:true,usageComplete:true};},
  usage:async()=>{throw Error('not needed in this fixture');}};
 return {input,calls,events,state};
}
test('replay intent is persisted without a provider mutation',async()=>{const f=fixture('replay-intent');await runPairedStage(f.input);assert.equal(f.events.length,1);assert.equal(f.events[0].event,'paired-edge-mutation-intent');assert.ok(f.calls.every(x=>!x.startsWith('apply:')));});
test('restore intent requires both prior replay and real usage completion',async()=>{const f=fixture('restore-intent');await runPairedStage(f.input);assert.deepEqual(f.calls.slice(0,2),['phase:replay','usage:usage-archive']);assert.equal(f.events[0].plan.phase,'restore');});
for(const phase of ['replay','restore'])test('stage authenticates '+phase+' intent before the first single-shot write',async()=>{const f=fixture(phase);await runPairedStage(f.input);assert.equal(f.calls[0],'intent:'+phase);assert.equal(f.calls.filter(x=>x.startsWith('apply:')).length,5);assert.equal(f.events.at(-1).event,'paired-edge-phase-complete');});
for(const name of ['loadIntent','loadPhase','loadUsage'])test('unverified '+name+' cannot advance stage',async()=>{
 const f=fixture(name==='loadIntent'?'replay':'restore-intent');f.input[name]=async()=>({originVerified:false,lineageVerified:true,phaseComplete:true,usageComplete:true});
 await assert.rejects(runPairedStage(f.input));assert.equal(f.events.length,0);assert.equal(f.calls.filter(x=>x.startsWith('apply:')).length,0);
});
test('an attempted timeout never retries or performs an implicit restore',async()=>{const f=fixture('replay');f.input.apply=async()=>{f.calls.push('uncertain-write');throw Error('synthetic private transport');};await assert.rejects(runPairedStage(f.input));assert.equal(f.calls.filter(x=>x==='uncertain-write').length,1);assert.ok(!f.events.some(e=>e.event==='paired-edge-phase-complete'));});

function usageReceipt(owned){
 const ledger=createRatePeriodLedger();
 for(let i=0;i<10;i++)recordRatePeriods(ledger,{observedAt:new Date(Date.parse('2026-11-05T12:01:00Z')+i*1000).toISOString(),rows:[]});
 const before=Object.fromEntries(['organizations','stalls','orders','order_sessions','subscriptions','products','product_categories',
  'stall_products','qr_codes','stall_ordering_settings','stall_capacity_settings','order_items'].map(n=>[n,1]));before.stall_business_hours=7;
 const receipt={schema:'stallorder-isolated-five-edge-usage/v1',project:'teunnvfakbfzmodajqjz',runId:'123',
  ownedOrganizationId:owned.organizationId,ownedStallId:owned.stallId,ownedOrderId:owned.orderId,ownedOrderSessionIds:[randomUUID()],
  calls:EDGE_SLUGS.map((slug,i)=>({slug,status:i===1?201:200,requestId:randomUUID(),observedAt:ledger.snapshots[i*2].observedAt})),
  fixtureCleanup:{before,after:Object.fromEntries(Object.keys(before).map(n=>[n,0])),attempts:{before:[],afterCount:0}},
  rateCleanup:verifyRateExpiry(ledger,'2026-11-05T12:01:10.000Z',true),failureStages:[],rateEvidenceComplete:true,
  rateSnapshots:ledger.snapshots,ownedFixtureRowsRemaining:0,requestsSettled:true,releaseAuthorized:false};
 receipt.fixtureCleanup.attempts.before=['SESSION_ISSUE','ORDER_SUBMIT'].map((eventType,i)=>({id:randomUUID(),
  requestId:receipt.calls[i].requestId,organizationId:owned.organizationId,stallId:owned.stallId,qrCodeId:owned.qrId,
  orderSessionId:receipt.ownedOrderSessionIds[0],eventType,outcome:'ALLOWED',reasonCode:i===0?'SESSION_ISSUED':'ORDER_CREATED'}));
 receipt.evidenceSha256=sha(JSON.stringify(receipt));return receipt;
}
function restoredState(f){for(const r of f.input.snapshot.functions)f.state.set(r.slug,{...structuredClone(r),metadata:{...r.metadata,version:12}});}
for(const phase of ['usage-archive','usage-candidate'])test(phase+' uses its own snapshot fixture only after authenticated phase and exact bytes',async()=>{
 const f=fixture(phase);if(phase==='usage-candidate')restoredState(f);
 let used;f.input.usage=async owned=>{used=owned;return usageReceipt(owned);};
 await runPairedStage(f.input);
 assert.deepEqual(used,f.input.snapshot.usageFixtures[phase==='usage-candidate'?1:0]);
 assert.equal(f.calls[0],'phase:'+(phase==='usage-candidate'?'restore':'replay'));
 assert.equal(f.events[0].event,'paired-edge-usage-start');assert.equal(f.events.at(-1).event,'paired-edge-usage-complete');
 assert.equal(f.calls.filter(x=>x.startsWith('apply:')).length,0);
});
for(const boundary of ['before','after'])test('changed '+boundary+' usage bytes cannot yield completed evidence',async()=>{
 const f=fixture('usage-archive');let used=0;
 const drift=()=>{f.state.get(EDGE_SLUGS[0]).metadata.version++;};if(boundary==='before')drift();
 f.input.usage=async owned=>{used++;if(boundary==='after')drift();return usageReceipt(owned);};
 await assert.rejects(runPairedStage(f.input));assert.equal(used,boundary==='before'?0:1);
 if(boundary==='before')assert.equal(f.events.length,0);
 else assert.equal(decodeIncompleteUsageEvidence({...f.input,events:f.events}).usageComplete,false);
});
test('dirty usage cleanup cannot emit a successful receipt',async()=>{
 const f=fixture('usage-archive');f.input.usage=async owned=>{const r=usageReceipt(owned);r.fixtureCleanup.after.order_sessions=1;
  delete r.evidenceSha256;r.evidenceSha256=sha(JSON.stringify(r));return r;};
 await assert.rejects(runPairedStage(f.input));
 const saved=decodeIncompleteUsageEvidence({...f.input,events:f.events});
 assert.equal(saved.usageComplete,false);assert.equal(saved.receipt.fixtureCleanup.after.order_sessions,1);
});
test('native usage failure preserves raw receipt and never logs the exception',async()=>{
 const f=fixture('usage-archive');const receipt=usageReceipt(f.input.snapshot.usageFixtures[0]);
 receipt.failureStages=['usage'];delete receipt.evidenceSha256;receipt.evidenceSha256=sha(JSON.stringify(receipt));
 f.input.usage=async()=>{const err=new Error('private transport diagnostic');err.receipt=receipt;throw err;};
 await assert.rejects(runPairedStage(f.input));
 assert.deepEqual(decodeIncompleteUsageEvidence({...f.input,events:f.events}).receipt,receipt);
 assert.ok(!JSON.stringify(f.events).includes('private transport diagnostic'));
});
test('final verification requires all four authenticated producer receipts and restored bytes',async()=>{
 const f=fixture('verify');restoredState(f);
 const result=await runPairedStage(f.input);
 assert.deepEqual(f.calls.slice(0,4),['phase:replay','phase:restore','usage:usage-archive','usage:usage-candidate']);
 assert.equal(result.cleanupVerified,true);assert.equal(result.productionRecoveryVerified,false);assert.equal(result.releaseAuthorized,false);
 assert.equal(f.calls.filter(x=>x.startsWith('apply:')).length,0);
});
test('final verification refuses stale replay bytes and cannot restore them implicitly',async()=>{
 const f=fixture('verify');await assert.rejects(runPairedStage(f.input));assert.equal(f.events.length,0);
 assert.equal(f.calls.filter(x=>x.startsWith('apply:')).length,0);
});
