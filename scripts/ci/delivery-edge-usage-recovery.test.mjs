import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {discoverRecoveryUsageIdentity} from './delivery-edge-usage-recovery.mjs';
const id='12345678-1234-4234-8234-123456789012',requestId='22345678-1234-4234-8234-123456789012';
function fixture({session=true,attempt=true}={}) {
 const owned=createUsageFixture('123'); const locks=[],reads=[];
 const sessions=session?[{id,organizationId:owned.organizationId,stallId:owned.stallId,qrCodeId:owned.qrId,
 orderingMode:'DELIVERY',orderId:null}]:[];
 const attempts=attempt?[{id:'32345678-1234-4234-8234-123456789012',requestId,organizationId:owned.organizationId,
 stallId:owned.stallId,qrCodeId:owned.qrId,orderSessionId:session?id:null}]:[];
 const tx={orderSession:{findMany:async args=>{reads.push({model:'session',args});return structuredClone(sessions);}},
 publicOrderAttempt:{findMany:async args=>{reads.push({model:'attempt',args});return structuredClone(attempts);}},
 $queryRawUnsafe:async(sql,...values)=>{locks.push({sql,values});return values.map(id=>({id}));}};
 return {owned,sessions,attempts,tx,locks,reads};
}
test('recovers an unprepared fixture without inferring successful requests',async()=>{
 const f=fixture({session:false,attempt:false}),result=await discoverRecoveryUsageIdentity(f.tx,f.owned);
 assert.deepEqual(result,{orderSessionIds:[],databaseObservedRequestIds:[],attemptIds:[]});assert.deepEqual(f.locks,[]);
});
test('finds committed session and organization-owned attempts after a lost response',async()=>{
 const f=fixture(),result=await discoverRecoveryUsageIdentity(f.tx,f.owned);
 assert.deepEqual(result,{orderSessionIds:[id],databaseObservedRequestIds:[requestId],attemptIds:[f.attempts[0].id]});
 assert.ok(f.reads.every(({args})=>args.where.OR.length===3||args.where.OR.length===4));
 assert.equal(f.reads[0].args.take,2);assert.equal(f.reads.find(r=>r.model==='attempt').args.take,101);
 assert.equal(f.locks.length,2);assert.ok(f.locks.every(l=>l.sql.includes('FOR UPDATE')));
 assert.equal(f.owned.orderSessionIds,undefined);assert.equal(result.calls,undefined);
});
test('accepts an owned committed order and multiple attempt rows for the same DB request',async()=>{
 const f=fixture();f.sessions[0].orderId=f.owned.orderId;
 f.attempts.push({...f.attempts[0],id:'42345678-1234-4234-8234-123456789012'});
 const result=await discoverRecoveryUsageIdentity(f.tx,f.owned);assert.equal(result.attemptIds.length,2);
 assert.deepEqual(result.databaseObservedRequestIds,[requestId]);
});
for(const [label,change] of [
 ['foreign organization',f=>{f.sessions[0].organizationId='f'.repeat(36);} ],
 ['foreign stall',f=>{f.sessions[0].stallId='f'.repeat(36);} ],
 ['foreign QR',f=>{f.sessions[0].qrCodeId='f'.repeat(36);} ],
 ['foreign order',f=>{f.sessions[0].orderId='f'.repeat(36);} ],
 ['non-delivery session',f=>{f.sessions[0].orderingMode='DEFAULT';}],
 ['second session',f=>{f.sessions.push({...f.sessions[0],id:requestId});}],
 ['invalid session ID',f=>{f.sessions[0].id='invalid';}],
])test('rejects '+label+' before locking attempts',async()=>{
 const f=fixture();change(f);await assert.rejects(discoverRecoveryUsageIdentity(f.tx,f.owned));
 assert.equal(f.locks.length,0);
});
for(const [label,change] of [
 ['nullable unknown organization',f=>{f.attempts[0].organizationId=null;}],
 ['foreign organization',f=>{f.attempts[0].organizationId=requestId;}],
 ['foreign stall',f=>{f.attempts[0].stallId=requestId;}],
 ['foreign QR',f=>{f.attempts[0].qrCodeId=requestId;}],
 ['foreign session',f=>{f.attempts[0].orderSessionId=requestId;}],
 ['invalid request ID',f=>{f.attempts[0].requestId='invalid';}],
 ['duplicate attempt ID',f=>{f.attempts.push({...f.attempts[0]});}],
 ['oversize attempts',f=>{f.attempts=Array(101).fill(f.attempts[0]);f.tx.publicOrderAttempt.findMany=async()=>f.attempts;}],
])test('retains '+label+' instead of allowing a parent cascade',async()=>{
 const f=fixture();change(f);await assert.rejects(discoverRecoveryUsageIdentity(f.tx,f.owned));
 assert.equal(f.locks.filter(x=>x.sql.includes('public_order_attempts')).length,0);
});
test('scoped organization attempt may have other nullable owners',async()=>{
 const f=fixture();Object.assign(f.attempts[0],{stallId:null,qrCodeId:null,orderSessionId:null});
 const result=await discoverRecoveryUsageIdentity(f.tx,f.owned);assert.equal(result.attemptIds.length,1);
});
test('rejects row drift or a missing locked row',async()=>{
 for(const mode of ['drift','missing','lock-timeout']) {
  const f=fixture();let reads=0;
  if(mode==='drift')f.tx.orderSession.findMany=async()=>{reads++;return reads===1?structuredClone(f.sessions):[];};
  else if(mode==='missing')f.tx.$queryRawUnsafe=async()=>[];
  else f.tx.$queryRawUnsafe=async()=>{throw Error('lock timeout');};
  await assert.rejects(discoverRecoveryUsageIdentity(f.tx,f.owned));
 }
});

import * as usage from './delivery-edge-usage.mjs';
test('independent wrapper never upgrades a scoped DB cleanup to complete usage acceptance',async()=>{
 const owned=createUsageFixture('123');let count=0;
 // This stub proves receipt semantics only; native DB cleanup remains a hosted gate.
 const db={$transaction:async()=>{count++;return {before:{organizations:0},after:{organizations:0},attempts:{before:[],afterCount:0}};}};
 const result=await usage.recoverIsolatedUsageFixtures({db,runId:'123',owned});
 assert.equal(count,1);assert.equal(result.ownedRowsRemainingAtReadback,0);
 for(const field of ['cleanupVerified','productQualified','releaseAuthorized'])assert.equal(result[field],false);
 for(const field of ['requestsSettled','globalAttemptsReconciled','sharedRateEffectsSettled'])assert.equal(result[field],null);
 assert.equal(result.sharedRowsDeleted,0);assert.equal(result.calls,undefined);
 assert.equal(owned.orderSessionIds,undefined);
});
test('wrong run and transaction failure never produce a cleanup receipt',async()=>{
 const owned=createUsageFixture('123');let count=0;
 const db={$transaction:async()=>{count++;throw Error('synthetic transaction rollback');}};
 await assert.rejects(()=>usage.recoverIsolatedUsageFixtures({db,runId:'124',owned}));assert.equal(count,0);
 await assert.rejects(()=>usage.recoverIsolatedUsageFixtures({db,runId:'123',owned}),/synthetic transaction rollback/);
 assert.equal(count,1);
});

test('DB-observed request ID cannot authorize deleting a nullable global attempt',async()=>{
 const f=fixture();let deletes=0;
 const row={id:f.attempts[0].id,requestId,organizationId:null,stallId:null,qrCodeId:null,orderSessionId:null,
 eventType:'GLOBAL_GATE',outcome:'DENIED',reasonCode:'LIMIT'};let rows=[row];
 const tx={publicOrderAttempt:{findMany:async()=>rows,deleteMany:async()=>{deletes++;rows=[];return {count:1};}}};
 await assert.rejects(()=>usage.reconcileUsageAttempts(tx,f.owned,[{requestId}],true));assert.equal(deletes,0);
});
