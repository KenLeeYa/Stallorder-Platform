import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {verifyIsolatedEdgeUsage} from './delivery-edge-usage.mjs';
import {createRatePeriodLedger,recordRatePeriods,verifyRateExpiry} from './delivery-edge-rate-expiry.mjs';
import {verifyPairedUsageReceipt,formatPairedUsageEvidence,decodePairedUsageEvidence,
 formatIncompleteUsageEvidence,decodeIncompleteUsageEvidence} from './delivery-edge-usage-evidence.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const slugs=['create-order-session','create-public-order','get-public-order','manage-line-link','prepare-reorder'];
function fixture(){
 const runId='123',owned=createUsageFixture(runId),ledger=createRatePeriodLedger();
 for(let i=0;i<10;i++)recordRatePeriods(ledger,{observedAt:new Date(Date.parse('2026-11-05T12:00:00Z')+i*1000).toISOString(),rows:[]});
 const receipt={schema:'stallorder-isolated-five-edge-usage/v1',project:'teunnvfakbfzmodajqjz',runId,
  ownedOrganizationId:owned.organizationId,ownedStallId:owned.stallId,ownedOrderId:owned.orderId,ownedOrderSessionIds:[randomUUID()],
  calls:slugs.map((slug,i)=>({slug,status:i===1?201:200,requestId:randomUUID(),observedAt:ledger.snapshots[i*2].observedAt})),
  fixtureCleanup:{before:{organizations:1,stalls:1,orders:1},after:{organizations:0,stalls:0,orders:0},attempts:{before:[],afterCount:0}},
  rateCleanup:verifyRateExpiry(ledger,'2026-11-05T12:00:10.000Z',true),failureStages:[],rateEvidenceComplete:true,
  rateSnapshots:ledger.snapshots,ownedFixtureRowsRemaining:0,requestsSettled:true,releaseAuthorized:false};
 const before=Object.fromEntries(['organizations','stalls','orders','order_sessions','subscriptions','products','product_categories',
  'stall_products','qr_codes','stall_ordering_settings','stall_capacity_settings','order_items'].map(n=>[n,1]));
 before.stall_business_hours=7;receipt.fixtureCleanup.before=before;receipt.fixtureCleanup.after=Object.fromEntries(Object.keys(before).map(n=>[n,0]));
 receipt.fixtureCleanup.attempts.before=['SESSION_ISSUE','ORDER_SUBMIT'].map((eventType,i)=>({id:randomUUID(),
  requestId:receipt.calls[i].requestId,organizationId:owned.organizationId,stallId:owned.stallId,qrCodeId:owned.qrId,
  orderSessionId:receipt.ownedOrderSessionIds[0],eventType,outcome:'ALLOWED',reasonCode:i===0?'SESSION_ISSUED':'ORDER_CREATED'}));
 receipt.evidenceSha256=sha(JSON.stringify(receipt));
 return {phase:'usage-archive',snapshot:{runId,project:receipt.project,controlCommit:'a'.repeat(40),runAttempt:1,
  usageFixtures:[owned,createUsageFixture(runId)]},snapshotSha256:'b'.repeat(64),receipt};
}
function rehash(f){delete f.receipt.evidenceSha256;f.receipt.evidenceSha256=sha(JSON.stringify(f.receipt));}
for(const [name,change] of [
 ['no issued session',f=>{f.receipt.fixtureCleanup.before.order_sessions=0;f.receipt.fixtureCleanup.after.order_sessions=0;}],
 ['missing QR and product inventory',f=>{for(const table of ['qr_codes','products']){delete f.receipt.fixtureCleanup.before[table];delete f.receipt.fixtureCleanup.after[table];}}],
 ['no correlated attempts',f=>{f.receipt.fixtureCleanup.attempts.before=[];}],
 ['wrong successful attempt reason',f=>{f.receipt.fixtureCleanup.attempts.before[0].reasonCode='UNKNOWN';}],
 ['session attempt belongs elsewhere',f=>{f.receipt.fixtureCleanup.attempts.before[0].orderSessionId=randomUUID();}],
])test('rejects review counterexample '+name,()=>{const f=fixture();change(f);rehash(f);assert.throws(()=>verifyPairedUsageReceipt(f));});
test('usage evidence binds all five real response records and owned cleanup to one snapshot fixture',()=>{
 const f=fixture(),r=verifyPairedUsageReceipt(f);assert.equal(r.usageComplete,true);assert.equal(r.releaseAuthorized,false);
 const events=formatPairedUsageEvidence(f);const loaded=decodePairedUsageEvidence({...f,events});
 assert.deepEqual(loaded.receipt,f.receipt);assert.equal(loaded.receiptSha256,sha(JSON.stringify(f.receipt)));
 assert.equal(loaded.mutationAuthorized,false);
});
for(const [name,change] of [
 ['wrong phase',f=>f.phase='usage-unknown'],['foreign fixture',f=>f.receipt.ownedStallId=randomUUID()],
 ['archive receipt as candidate',f=>f.phase='usage-candidate'],['missing session',f=>f.receipt.ownedOrderSessionIds=[]],
 ['duplicate request',f=>f.receipt.calls[1].requestId=f.receipt.calls[0].requestId],
 ['missing call',f=>f.receipt.calls.pop()],['failed call',f=>f.receipt.calls[2].status=500],
 ['unsettled request',f=>f.receipt.requestsSettled=false],['cleanup failed',f=>f.receipt.failureStages.push('fixture-cleanup')],
 ['leftover fixture',f=>f.receipt.fixtureCleanup.after.stalls=1],['omitted inventory table',f=>delete f.receipt.fixtureCleanup.after.orders],
 ['leftover attempt',f=>f.receipt.fixtureCleanup.attempts.afterCount=1],['false zero claim',f=>f.receipt.ownedFixtureRowsRemaining=null],
 ['shared deletion',f=>f.receipt.rateCleanup.sharedRowsDeleted=1],['missing rate pair',f=>f.receipt.rateSnapshots.pop()],
 ['rate digest mismatch',f=>f.receipt.rateSnapshots[0].sha256='c'.repeat(64)],
 ['forged expired period',f=>f.receipt.rateCleanup.retainedRatePeriods.push({keySha256:'d'.repeat(64),expiresAt:'2026-11-05T12:00:09.000Z'})],
 ['claim release',f=>f.receipt.releaseAuthorized=true],['unexpected secret field',f=>f.receipt.token='synthetic-private'],
])test('usage evidence refuses '+name,()=>{const f=fixture();change(f);rehash(f);assert.throws(()=>verifyPairedUsageReceipt(f));});
test('receipt checksum cannot be replaced without exact receipt bytes',()=>{const f=fixture();f.receipt.evidenceSha256='e'.repeat(64);assert.throws(()=>verifyPairedUsageReceipt(f));});
for(const [name,change] of [
 ['missing chunk',a=>a.splice(1,1)],['duplicate frame',a=>a.splice(1,0,a[1])],
 ['changed chunk',a=>a[1].data='AAAA'],['wrong source',a=>a[0].controlCommit='c'.repeat(40)],
 ['wrong phase',a=>a[0].phase='usage-candidate'],['trailing event',a=>a.push(a.at(-1))],
])test('framed usage refuses '+name,()=>{const f=fixture(),events=formatPairedUsageEvidence(f);change(events);assert.throws(()=>decodePairedUsageEvidence({...f,events}));});
test('large rate evidence round trips in bounded frames without dropping observations',()=>{
 const f=fixture(),ledger=createRatePeriodLedger();
 for(let i=0;i<10;i++)recordRatePeriods(ledger,{observedAt:new Date(Date.parse('2026-11-05T12:00:00Z')+i*1000).toISOString(),rows:Array.from({length:700},(_,j)=>({key:'synthetic-'+j,scope:'global',count:1,expiresAt:'2026-11-05T12:00:05.000Z',updatedAt:'2026-11-05T11:59:00.000Z'}))});
 f.receipt.rateSnapshots=ledger.snapshots;f.receipt.rateCleanup=verifyRateExpiry(ledger,'2026-11-05T12:00:10.000Z',true);rehash(f);
 const events=formatPairedUsageEvidence(f);assert.ok(events.length>3);assert.ok(events.every(e=>Buffer.byteLength(JSON.stringify(e))<12000));
 assert.deepEqual(decodePairedUsageEvidence({...f,events}).receipt,f.receipt);
});

test('incomplete usage retains the exact partial receipt but cannot enter the success decoder',()=>{
 const f=fixture();f.receipt.calls.length=2;f.receipt.rateSnapshots.length=4;f.receipt.rateCleanup=null;
 f.receipt.fixtureCleanup=null;f.receipt.ownedFixtureRowsRemaining=null;f.receipt.failureStages=['usage','fixture-cleanup'];rehash(f);
 const events=formatIncompleteUsageEvidence(f),r=decodeIncompleteUsageEvidence({...f,events});
 assert.deepEqual(r.receipt,f.receipt);assert.equal(r.usageComplete,false);assert.equal(r.incomplete,true);assert.equal(r.releaseAuthorized,false);
 assert.throws(()=>decodePairedUsageEvidence({...f,events}));
 assert.throws(()=>decodeIncompleteUsageEvidence({...f,events:events.slice(0,-1)}));
});
test('incomplete framing rejects a foreign receipt or exception fields',()=>{
 for(const change of [f=>f.receipt.ownedStallId=randomUUID(),f=>f.receipt.stack='synthetic private stack',
  f=>f.receipt.releaseAuthorized=true]){const f=fixture();change(f);rehash(f);assert.throws(()=>formatIncompleteUsageEvidence(f));}
});
for(const cleanupFails of [false,true])test('actual timeout producer retains missing cleanup results through JSON transport '+cleanupFails,async()=>{
 const owned=createUsageFixture('123');let transactions=0;
 const db={$transaction:async()=>{transactions++;if(cleanupFails&&transactions===2)throw Error('synthetic cleanup error');
  return {before:{organizations:1},after:{organizations:0}};},
  $queryRawUnsafe:async()=>[{observed:'2026-11-05T12:00:00.000Z',buckets:[]}]};
 let error;try{await verifyIsolatedEdgeUsage({db,origin:'https://stallorder-platform-test123-ada76145-8663s-projects.vercel.app',
  anonKey:'synthetic-not-a-credential',runId:'123',owned,request:async()=>{throw Error('synthetic private timeout');}});}catch(e){error=e;}
 assert.ok(error?.receipt);const input={phase:'usage-archive',snapshot:{runId:'123',project:error.receipt.project,
  controlCommit:'a'.repeat(40),runAttempt:1,usageFixtures:[owned,createUsageFixture('123')]},snapshotSha256:'b'.repeat(64),receipt:error.receipt};
 const events=formatIncompleteUsageEvidence(input);
 assert.deepEqual(decodeIncompleteUsageEvidence({...input,events}).receipt,error.receipt);
 assert.equal(error.receipt.rateCleanup,null);if(cleanupFails)assert.equal(error.receipt.fixtureCleanup,null);
 assert.throws(()=>decodePairedUsageEvidence({...input,events}));
});
