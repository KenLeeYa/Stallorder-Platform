import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const rateKey=(scope,identifier)=>createHash('sha256').update(scope+':'+identifier).digest('hex');
// This overlay never deletes or changes a bucket. The existing checkRateLimit SQL owns GC/upserts.
// original expiry <= the frozen runtime start is narrower than SQL expiry <= each invocation's now.
export function assertRuntimeRates({original,current,startedAt,completedAt,allowed,processProof}){
 const start=Date.parse(startedAt),end=Date.parse(completedAt);assert.ok(Number.isFinite(start)&&end>=start);
 assert.equal(original.length,47);assert.equal(new Set(original.map(r=>r.key)).size,47);
 const currentByKey=new Map(current.map(r=>[r.key,r]));assert.equal(currentByKey.size,current.length);
 const removed=original.filter(row=>!currentByKey.has(row.key));
 if(removed.length){assert.ok(Number.isInteger(processProof?.appPid)&&processProof.appPid>0);assert.match(processProof.commandSha256,/^[a-f0-9]{64}$/);assert.ok(processProof.calls.length>0);assert.ok(processProof.calls.some(c=>c.requestId&&c.status>=200&&c.status<=499&&Date.parse(c.completedAt)>=start&&Date.parse(c.completedAt)<=end&&c.rateLimitExecuted===true));assert.ok(removed.length<=100*processProof.calls.filter(c=>c.rateLimitExecuted).length);}
 for(const row of original){const currentRow=currentByKey.get(row.key);if(currentRow)assert.deepEqual(currentRow,row,'OLD_RATE_MUTATION');else assert.ok(Date.parse(row.expires_at)<=start,'UNEXPIRED_OLD_RATE_REMOVED');}
 const newRows=current.filter(row=>!original.some(old=>old.key===row.key));
 for(const row of newRows){const rule=allowed.find(r=>r.key===row.key&&r.scope===row.scope);assert.ok(rule,'UNOWNED_RATE_KEY');assert.equal(row.key,rateKey(rule.scope,rule.identifier));assert.ok(Number.isInteger(row.count)&&row.count>=1);assert.equal(row.count,rule.expectedCurrentWindowCalls,'RATE_COUNTER_MISMATCH');assert.ok(Date.parse(row.updated_at)>=start&&Date.parse(row.updated_at)<=end);assert.ok(Date.parse(row.expires_at)>Date.parse(row.updated_at));assert.ok(Date.parse(row.expires_at)<=end+rule.windowMs);}
 return {version:'native-runtime-rate-gc-v1',original:47,removed:removed.map(r=>r.key),retained:47-removed.length,newOwned:newRows.length,cleanupOwner:'src/lib/rate-limit.ts checkRateLimit expired <= now order by expires_at limit 100'};
}
