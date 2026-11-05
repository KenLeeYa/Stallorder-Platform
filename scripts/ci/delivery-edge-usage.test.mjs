import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIsolatedEdgeUsage, reconcileUsageAttempts, verifyUsageOperationalEvents, inventoryUsageFixtures} from './delivery-edge-usage.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';

// Exercise the real request/finally boundary. Database fixture transactions are
// stubbed here; these tests make no database-cleanup or provider acceptance claim.
function boundary({postFails=false, clockFails=false, waitFails=false, timeout=false}={}) {
  let snapshots=0, cleanups=0;
  const now=new Date().toISOString();
  const db={
    $transaction:async()=>{cleanups++;return {before:{organizations:1},after:{organizations:0}};},
    $queryRawUnsafe:async sql=>{
      if(sql.includes('rate_limit_buckets')) {
        snapshots++;
        if(postFails && snapshots===2)throw Error('private snapshot error');
        return [{observed:now,buckets:snapshots===1?[]:[{key:'synthetic',scope:'public-ip',count:1,
          expires_at:waitFails?new Date(Date.now()+60000).toISOString():now,updated_at:now}]}];
      }
      if(clockFails)throw Error('private clock error');
      return [{observed:new Date().toISOString()}];
    },
  };
  const requestId='12345678-1234-4123-8123-123456789012';
  return {cleanups:()=>cleanups, requestId, invoke:()=>verifyIsolatedEdgeUsage({db,
    origin:'https://stallorder-platform-test123-ada76145-8663s-projects.vercel.app',
    anonKey:'synthetic-key-with-no-provider-access',runId:'123',owned:createUsageFixture('123'),
    request:async()=>{if(timeout)throw Error('private timeout'); return Response.json({error:'limited'},
      {status:429,headers:{'x-request-id':requestId,'cache-control':'no-store'}});},
    wait:async()=>{if(waitFails)throw Error('private wait error');},
  })};
}
for(const mode of ['postFails','clockFails','waitFails','timeout'])test(`preserves incomplete receipt after ${mode}`,async()=>{
  const f=boundary({[mode]:true});
  let caught;try{await f.invoke();}catch(error){caught=error;}
  assert.equal(caught?.message,'EDGE_USAGE_OR_CLEANUP_FAILED');
  assert.equal(caught.receipt.releaseAuthorized,false);
  assert.equal(f.cleanups(),2);
  assert.ok(!JSON.stringify(caught.receipt).includes('private'));
  if(mode==='postFails') {
    assert.equal(caught.receipt.rateEvidenceComplete,false);
    assert.equal(caught.receipt.rateCleanup,null);
    assert.equal(caught.receipt.calls[0].requestId,f.requestId);
  }
  if(mode==='timeout') {
    assert.equal(caught.receipt.requestsSettled,false);
    assert.equal(caught.receipt.ownedFixtureRowsRemaining,null);
  }
});
test('no fixture may be generated after the durable snapshot or recovered from an unknown run',async()=>{
  let writes=0;
  for(const owned of [undefined,createUsageFixture('124')])await assert.rejects(()=>verifyIsolatedEdgeUsage({
    db:{$transaction:async()=>{writes++;throw Error('should not be reached');}},
    origin:'https://stallorder-platform-test123-ada76145-8663s-projects.vercel.app',
    anonKey:'synthetic-key-with-no-provider-access',runId:'123',owned,
  }));
  assert.equal(writes,0);
});
const owned={organizationId:'11111111-1111-4111-8111-111111111111',stallId:'22222222-2222-4222-8222-222222222222',
  qrId:'33333333-3333-4333-8333-333333333333'};
const calls=[{requestId:'44444444-4444-4444-8444-444444444444'}];
function inventoryDb({foreign=0}={}) {
  const queries=[];
  const columns=[...Array.from({length:21},(_,i)=>({table_name:`fixture_${i}`,column_name:'organization_id'})),
    ...['organization_id','stall_id'].map(column_name=>({table_name:'audit_logs',column_name}))];
  return {queries,db:{$queryRawUnsafe:async(sql,...values)=>{
    if(sql.includes('information_schema.columns'))return columns;
    if(sql.includes('pg_constraint'))return [];
    queries.push({sql,values});
    return [{n:sql.includes('"audit_logs"')&&sql.includes(' OR ')?1:0,foreign_count:sql.includes('"audit_logs"')?foreign:0}];
  },organization:{count:async()=>1},staffPushDelivery:{count:async()=>0}}};
}
test('inventory retains all ownership columns so nullable organization cannot hide an owned-stall reference',async()=>{
  const f=inventoryDb();const result=await inventoryUsageFixtures(f.db,owned);
  assert.equal(result.audit_logs,1);
  const query=f.queries.find(item=>item.sql.includes('"audit_logs"'));
  assert.deepEqual(query.values,[owned.organizationId,owned.stallId]);
  assert.match(query.sql,/"organization_id"=\$1::uuid OR "stall_id"=\$2::uuid/);
});
test('inventory refuses mixed or missing organization ownership before cascading deletion',async()=>{
  const f=inventoryDb({foreign:1});
  await assert.rejects(()=>inventoryUsageFixtures(f.db,owned),/EDGE_USAGE_FOREIGN_REFERENCE/);
});
test('cleanup accepts the ORDER_CREATED result emitted by the actual order-event trigger',()=>{
  const scope={...owned,orderId:'77777777-7777-4777-8777-777777777777'};
  // emit_order_operational_event maps WAITING_CONFIRMATION to ORDER_CREATED.
  const event={stallId:scope.stallId,entityType:'ORDER',entityId:scope.orderId,eventType:'ORDER_CREATED'};
  assert.doesNotThrow(()=>verifyUsageOperationalEvents([event,event],scope));
  for(const change of [{stallId:'foreign'},{entityType:'PAYMENT'},{entityId:'foreign'},
    {eventType:'PAYMENT_RECORDED'},{eventType:'PUBLIC_ORDER_CREATED'}]) {
    assert.throws(()=>verifyUsageOperationalEvents([{...event,...change}],scope));
  }
  assert.throws(()=>verifyUsageOperationalEvents([event,event,event],scope));
});
function attemptsDb(row) {
  let remaining=[row]; const deleted=[];
  return {deleted,tx:{publicOrderAttempt:{
    findMany:async()=>remaining,
    deleteMany:async ({where})=>{deleted.push(where);const count=remaining.length;remaining=[];return {count};},
  }}};
}
test('cleanup evidence selects correlation and result fields without private request hashes',async()=>{
 const selected=[];
 const tx={publicOrderAttempt:{findMany:async args=>{selected.push(args.select);return [];},deleteMany:async()=>({count:0})}};
 await reconcileUsageAttempts(tx,owned,calls);
 assert.equal(selected.length,2);
 for(const select of selected)assert.deepEqual(Object.keys(select).sort(),['id','requestId','organizationId','stallId',
  'qrCodeId','orderSessionId','eventType','outcome','reasonCode'].sort());
});
test('detects foreign request references to the owned stall or QR before SET NULL can hide them',async()=>{
  for(const reference of [{stallId:owned.stallId},{qrCodeId:owned.qrId}]) {
    const row={id:'55555555-5555-4555-8555-555555555555',requestId:'66666666-6666-4666-8666-666666666666',
      organizationId:null,stallId:null,qrCodeId:null,orderSessionId:null,...reference};
    let deletes=0;
    const tx={publicOrderAttempt:{
      findMany:async({where})=>where.OR.some(scope=>Object.entries(scope).some(([key,value])=>row[key]===value))?[row]:[],
      deleteMany:async()=>{deletes++;return {count:0};},
    }};
    await assert.rejects(()=>reconcileUsageAttempts(tx,owned,calls),/EDGE_USAGE_FOREIGN_ATTEMPT/);
    assert.equal(deletes,0);
  }
});
test('detects a session-only attempt even when it has no organization, stall or QR',async()=>{
  const sessionId='77777777-7777-4777-8777-777777777777';
  const row={id:'55555555-5555-4555-8555-555555555555',requestId:'66666666-6666-4666-8666-666666666666',
    organizationId:null,stallId:null,qrCodeId:null,orderSessionId:sessionId};
  let deletes=0;
  const tx={publicOrderAttempt:{
    findMany:async({where})=>where.OR.some(scope=>scope.orderSessionId?.in?.includes(sessionId))?[row]:[],
    deleteMany:async()=>{deletes++;return {count:0};},
  }};
  await assert.rejects(()=>reconcileUsageAttempts(tx,{...owned,orderSessionIds:[sessionId]},calls),/EDGE_USAGE_FOREIGN_ATTEMPT/);
  assert.equal(deletes,0);
});
test('reconciles a received global denial by request ID even without organization scope',async()=>{
  const row={id:'55555555-5555-4555-8555-555555555555',requestId:calls[0].requestId,
    organizationId:null,stallId:null,qrCodeId:null,orderSessionId:null};
  const f=attemptsDb(row);const result=await reconcileUsageAttempts(f.tx,owned,calls);
  assert.equal(result.afterCount,0);assert.equal(result.before.length,1);
  assert.deepEqual(f.deleted[0].id,{in:[row.id]});
  assert.deepEqual(f.deleted[0].requestId,{in:[row.requestId]});
});
test('refuses a foreign attempt before deletion',async()=>{
  for(const change of [{organizationId:'foreign'},{stallId:'foreign'},{qrCodeId:'foreign'},
    {requestId:'66666666-6666-4666-8666-666666666666'}]) {
    const f=attemptsDb({id:'55555555-5555-4555-8555-555555555555',requestId:calls[0].requestId,
      organizationId:null,stallId:null,qrCodeId:null,orderSessionId:null,...change});
    await assert.rejects(()=>reconcileUsageAttempts(f.tx,owned,calls));
    assert.equal(f.deleted.length,0);
  }
});
