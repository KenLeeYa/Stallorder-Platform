import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {validateUsageFixturePair} from './delivery-edge-usage-fixture.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const hex = /^[a-f0-9]{64}$/;
const slugs = ['create-order-session','create-public-order','get-public-order','manage-line-link','prepare-reorder'];
const maxBytes = 96 * 1024 * 1024, chunkSize = 8192, maxChunks = 8192;
const receiptFields = ['schema','project','runId','ownedOrganizationId','ownedStallId','ownedOrderId',
  'ownedOrderSessionIds','calls','fixtureCleanup','rateCleanup','failureStages','rateEvidenceComplete',
  'rateSnapshots','ownedFixtureRowsRemaining','requestsSettled','releaseAuthorized','evidenceSha256'];
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
function time(value) {
  assert.equal(typeof value,'string'); const n=Date.parse(value);
  assert.ok(Number.isFinite(n)); assert.equal(new Date(n).toISOString(),value); return n;
}
function identity({snapshot,snapshotSha256,phase}) {
  assert.equal(snapshot.project,'teunnvfakbfzmodajqjz'); assert.equal(snapshot.runAttempt,1);
  assert.match(snapshot.controlCommit??'',/^[a-f0-9]{40}$/); assert.match(snapshot.runId??'',/^[1-9][0-9]*$/);
  assert.match(snapshotSha256??'',hex); assert.ok(['usage-archive','usage-candidate'].includes(phase));
  validateUsageFixturePair(snapshot.usageFixtures,snapshot.runId);
  return {project:snapshot.project,controlCommit:snapshot.controlCommit,runId:snapshot.runId,
    runAttempt:1,snapshotSha256,phase};
}

// A pure receipt check. Only an authenticated completed-job loader can establish
// provenance; these fields never authorize mutation or a Production release.
export function verifyPairedUsageReceipt({snapshot,snapshotSha256,phase,receipt}) {
  const binding=identity({snapshot,snapshotSha256,phase});
  keys(receipt,receiptFields);
  assert.equal(receipt.schema,'stallorder-isolated-five-edge-usage/v1');
  assert.equal(receipt.project,binding.project); assert.equal(receipt.runId,binding.runId);
  const owned=snapshot.usageFixtures[phase==='usage-archive'?0:1];
  for(const [key,field] of [['ownedOrganizationId','organizationId'],['ownedStallId','stallId'],['ownedOrderId','orderId']])
    assert.equal(receipt[key],owned[field]);
  assert.equal(receipt.ownedOrderSessionIds.length,1); assert.match(receipt.ownedOrderSessionIds[0],uuid);
  assert.deepEqual(receipt.failureStages,[]); assert.equal(receipt.rateEvidenceComplete,true);
  assert.equal(receipt.ownedFixtureRowsRemaining,0); assert.equal(receipt.requestsSettled,true);
  assert.equal(receipt.releaseAuthorized,false);
  const {evidenceSha256,...body}=receipt; assert.equal(evidenceSha256,digest(body));
  assert.deepEqual(receipt.calls.map(c=>c.slug),slugs);
  assert.equal(new Set(receipt.calls.map(c=>c.requestId)).size,5);
  for(const call of receipt.calls) {
    keys(call,['slug','status','requestId','observedAt']); assert.ok([200,201].includes(call.status));
    assert.match(call.requestId,uuid); time(call.observedAt);
  }
  const cleanup=receipt.fixtureCleanup; keys(cleanup,['before','after','attempts']);
  keys(cleanup.after,Object.keys(cleanup.before));
  for(const [table,count] of Object.entries(cleanup.before)) {
    assert.match(table,/^[a-z][a-z0-9_]*$/); assert.ok(Number.isSafeInteger(count)&&count>=0&&count<=100);
    assert.equal(cleanup.after[table],0);
  }
  for(const table of ['organizations','stalls','orders','order_sessions','subscriptions','products','product_categories',
    'stall_products','qr_codes','stall_ordering_settings','stall_capacity_settings','order_items']) assert.equal(cleanup.before[table],1);
  assert.equal(cleanup.before.stall_business_hours,7);
  keys(cleanup.attempts,['before','afterCount']); assert.equal(cleanup.attempts.afterCount,0);
  assert.ok(Array.isArray(cleanup.attempts.before)&&cleanup.attempts.before.length<=100);
  assert.equal(new Set(cleanup.attempts.before.map(r=>r.id)).size,cleanup.attempts.before.length);
  for(const row of cleanup.attempts.before) {
    keys(row,['id','requestId','organizationId','stallId','qrCodeId','orderSessionId','eventType','outcome','reasonCode']); assert.match(row.id,uuid);
    assert.ok(receipt.calls.some(c=>c.requestId===row.requestId));
    assert.match(row.eventType,/^[A-Z0-9_]{1,80}$/); assert.match(row.reasonCode,/^[A-Z0-9_]{1,120}$/);
    assert.ok(['ALLOWED','DENIED','ERROR'].includes(row.outcome));
    for(const [key,values] of Object.entries({organizationId:[null,owned.organizationId],stallId:[null,owned.stallId],
      qrCodeId:[null,owned.qrId],orderSessionId:[null,...receipt.ownedOrderSessionIds]})) assert.ok(values.includes(row[key]));
  }
  for(const [i,eventType,reasonCode] of [[0,'SESSION_ISSUE','SESSION_ISSUED'],[1,'ORDER_SUBMIT','ORDER_CREATED']]) {
    const attempts=cleanup.attempts.before.filter(r=>r.requestId===receipt.calls[i].requestId&&
      r.eventType===eventType&&r.reasonCode===reasonCode&&r.outcome==='ALLOWED');
    assert.equal(attempts.length,1);
    assert.equal(attempts[0].organizationId,owned.organizationId); assert.equal(attempts[0].stallId,owned.stallId);
    assert.equal(attempts[0].qrCodeId,owned.qrId); assert.equal(attempts[0].orderSessionId,receipt.ownedOrderSessionIds[0]);
  }
  const snapshots=receipt.rateSnapshots; assert.equal(snapshots.length,10);
  const periods=new Map(); let last=-Infinity;
  for(const [i,s] of snapshots.entries()) {
    keys(s,['observedAt','rows','sha256']); const at=time(s.observedAt); assert.ok(last<=at); last=at;
    assert.ok(Array.isArray(s.rows)&&s.rows.length<=20000);
    assert.equal(new Set(s.rows.map(r=>r.keySha256)).size,s.rows.length); assert.equal(s.sha256,digest(s.rows));
    for(const row of s.rows) {
      keys(row,['keySha256','scope','count','expiresAt','updatedAt']); assert.match(row.keySha256,hex);
      assert.match(row.scope,/^[a-zA-Z0-9:_-]{1,128}$/); assert.ok(Number.isSafeInteger(row.count)&&row.count>=0);
      time(row.expiresAt); assert.ok(time(row.updatedAt)<=at);
    }
    if(i%2===0) assert.equal(receipt.calls[i/2].observedAt,s.observedAt);
    else {
      const before=new Map(snapshots[i-1].rows.map(r=>[r.keySha256,r])),after=new Map(s.rows.map(r=>[r.keySha256,r]));
      for(const key of new Set([...before.keys(),...after.keys()])) {
        if(JSON.stringify(before.get(key))===JSON.stringify(after.get(key)))continue;
        for(const row of [before.get(key),after.get(key)].filter(Boolean))
          if(time(row.expiresAt)>=at)periods.set(digest([key,row.expiresAt]),{keySha256:key,expiresAt:row.expiresAt});
      }
    }
  }
  const rate=receipt.rateCleanup,now=time(rate.databaseObservedAt); assert.ok(last<=now);
  assert.ok([...periods.values()].every(p=>time(p.expiresAt)<=now));
  assert.deepEqual(rate,{databaseObservedAt:rate.databaseObservedAt,activeSyntheticRateEffectRemaining:0,
    retainedObservedPeriods:periods.size,retainedRatePeriods:[...periods.values()],snapshots,
    sharedRowsDeleted:0,zeroRowsClaimed:false});
  return {...binding,usageComplete:true,receiptSha256:digest(receipt),
    mutationAuthorized:false,releaseAuthorized:false};
}

export function formatPairedUsageEvidence(input) {
  const checked=verifyPairedUsageReceipt(input);
  return frameReceipt(input,checked.receiptSha256,'paired-edge-usage');
}
// Transport the trusted usage producer's raw incomplete receipt without
// reclassifying it as a pass or including an exception message/stack/cause.
function incompleteReceipt(input) {
  const binding=identity(input),receipt=input.receipt;
  keys(receipt,receiptFields);assert.equal(receipt.schema,'stallorder-isolated-five-edge-usage/v1');
  assert.equal(receipt.project,binding.project);assert.equal(receipt.runId,binding.runId);
  assert.equal(receipt.releaseAuthorized,false);
  const owned=input.snapshot.usageFixtures[input.phase==='usage-archive'?0:1];
  for(const [key,field] of [['ownedOrganizationId','organizationId'],['ownedStallId','stallId'],['ownedOrderId','orderId']])assert.equal(receipt[key],owned[field]);
  const {evidenceSha256,...body}=receipt;assert.equal(evidenceSha256,digest(body));
  return {...binding,receiptSha256:digest(receipt),incomplete:true,usageComplete:false,
    mutationAuthorized:false,releaseAuthorized:false};
}
export function formatIncompleteUsageEvidence(input) {
  const checked=incompleteReceipt(input);
  return frameReceipt(input,checked.receiptSha256,'paired-edge-usage-failed');
}
function frameReceipt(input,receiptSha256,prefix) {
  const bytes=Buffer.from(JSON.stringify(input.receipt));
  assert.ok(bytes.length>0&&bytes.length<=maxBytes);
  const packed=gzipSync(bytes).toString('base64'),chunks=Math.ceil(packed.length/chunkSize);
  assert.ok(chunks>0&&chunks<=maxChunks);
  const start={event:prefix+'-start',...identity(input),encoding:'gzip-base64',
    bytes:bytes.length,sha256:receiptSha256,chunks};
  return [start,...Array.from({length:chunks},(_,index)=>({event:prefix+'-chunk',index,
    data:packed.slice(index*chunkSize,(index+1)*chunkSize)})),
  {event:prefix+'-complete',sha256:start.sha256,chunks}];
}
export function decodePairedUsageEvidence(input) {
  const receipt=decodeFrames(input,'paired-edge-usage');
  return {...verifyPairedUsageReceipt({...input,receipt}),receipt};
}
export function decodeIncompleteUsageEvidence(input) {
  const receipt=decodeFrames(input,'paired-edge-usage-failed');
  return {...incompleteReceipt({...input,receipt}),receipt};
}
function decodeFrames(input,prefix) {
  const {events}=input; assert.ok(Array.isArray(events)&&events.length>=3&&events.length<=maxChunks+2);
  const first=events[0]; assert.ok(Number.isSafeInteger(first.bytes)&&first.bytes>0&&first.bytes<=maxBytes);
  assert.ok(Number.isSafeInteger(first.chunks)&&first.chunks>0&&first.chunks<=maxChunks); assert.match(first.sha256,hex);
  assert.deepEqual(first,{event:prefix+'-start',...identity(input),encoding:'gzip-base64',
    bytes:first.bytes,sha256:first.sha256,chunks:first.chunks});
  assert.equal(events.length,first.chunks+2); let packed='';
  for(let i=0;i<first.chunks;i++) {
    const e=events[i+1]; keys(e,['event','index','data']); assert.equal(e.event,prefix+'-chunk'); assert.equal(e.index,i);
    assert.equal(typeof e.data,'string'); assert.ok(e.data.length>0&&e.data.length<=chunkSize);
    if(i<first.chunks-1) assert.equal(e.data.length,chunkSize); packed+=e.data;
  }
  assert.deepEqual(events.at(-1),{event:prefix+'-complete',sha256:first.sha256,chunks:first.chunks});
  const compressed=Buffer.from(packed,'base64'); assert.equal(compressed.toString('base64'),packed);
  const bytes=gunzipSync(compressed,{maxOutputLength:maxBytes});
  assert.equal(bytes.length,first.bytes); assert.equal(hash(bytes),first.sha256);
  const receipt=JSON.parse(bytes.toString('utf8')); assert.equal(JSON.stringify(receipt),bytes.toString('utf8'));
  return receipt;
}
