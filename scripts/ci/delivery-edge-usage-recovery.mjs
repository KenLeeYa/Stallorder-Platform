import assert from 'node:assert/strict';
import {validateUsageFixture} from './delivery-edge-usage-fixture.mjs';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
async function lockRows(tx,table,rows) {
 if(!rows.length)return;
 const ids=rows.map(row=>row.id).sort();
 assert.equal(new Set(ids).size,ids.length);for(const id of ids)assert.match(id,uuid);
 const placeholders=ids.map((_,i)=>'$'+(i+1)+'::uuid').join(',');
 const locked=await tx.$queryRawUnsafe('SELECT id FROM public."'+table+'" WHERE id IN ('+placeholders+') ORDER BY id FOR UPDATE',...ids);
 assert.deepEqual(locked.map(row=>row.id).sort(),ids,'EDGE_RECOVERY_USAGE_LOCK_CHANGED');
}
// Called inside the existing Serializable cleanup transaction after parent
// FOR UPDATE locks. Only fresh fixture organization ownership admits a missing
// response correlation; nullable or foreign owner references still fail closed.
// These DB-observed request IDs are not evidence of successful HTTP requests.
export async function discoverRecoveryUsageIdentity(tx,owned) {
 validateUsageFixture(owned,owned.runId);
 const sessionQuery={where:{OR:[{organizationId:owned.organizationId},{stallId:owned.stallId},{qrCodeId:owned.qrId}]},
  select:{id:true,organizationId:true,stallId:true,qrCodeId:true,orderingMode:true,orderId:true},orderBy:{id:'asc'},take:2};
 const sessions=await tx.orderSession.findMany(sessionQuery);assert.ok(sessions.length<=1,'EDGE_RECOVERY_USAGE_SESSION');
 for(const row of sessions) {
  assert.match(row.id,uuid);assert.equal(row.organizationId,owned.organizationId,'EDGE_RECOVERY_USAGE_SESSION');
  assert.equal(row.stallId,owned.stallId,'EDGE_RECOVERY_USAGE_SESSION');assert.equal(row.qrCodeId,owned.qrId,'EDGE_RECOVERY_USAGE_SESSION');
  assert.equal(row.orderingMode,'DELIVERY','EDGE_RECOVERY_USAGE_SESSION');assert.ok([null,owned.orderId].includes(row.orderId),'EDGE_RECOVERY_USAGE_SESSION');
 }
 await lockRows(tx,'order_sessions',sessions);
 assert.deepEqual(await tx.orderSession.findMany(sessionQuery),sessions,'EDGE_RECOVERY_USAGE_SESSION_CHANGED');
 const sessionIds=sessions.map(row=>row.id);
 const attemptQuery={where:{OR:[{organizationId:owned.organizationId},{stallId:owned.stallId},{qrCodeId:owned.qrId},
  {orderSessionId:{in:sessionIds}}]},select:{id:true,requestId:true,organizationId:true,stallId:true,qrCodeId:true,orderSessionId:true},
  orderBy:{id:'asc'},take:101};
 const attempts=await tx.publicOrderAttempt.findMany(attemptQuery);
 assert.ok(attempts.length<=100,'EDGE_RECOVERY_USAGE_ATTEMPT_LIMIT');
 assert.equal(new Set(attempts.map(row=>row.id)).size,attempts.length);
 for(const row of attempts) {
  assert.match(row.id,uuid);assert.match(row.requestId,uuid);
  assert.equal(row.organizationId,owned.organizationId,'EDGE_RECOVERY_USAGE_UNKNOWN_ATTEMPT');
  assert.ok([null,owned.stallId].includes(row.stallId)&&[null,owned.qrId].includes(row.qrCodeId)
   &&[null,...sessionIds].includes(row.orderSessionId),'EDGE_RECOVERY_USAGE_FOREIGN_ATTEMPT');
 }
 await lockRows(tx,'public_order_attempts',attempts);
 assert.deepEqual(await tx.publicOrderAttempt.findMany(attemptQuery),attempts,'EDGE_RECOVERY_USAGE_ATTEMPT_CHANGED');
 return {orderSessionIds:sessionIds,databaseObservedRequestIds:[...new Set(attempts.map(row=>row.requestId))],attemptIds:attempts.map(row=>row.id)};
}
