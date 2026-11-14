import test from 'node:test';
import assert from 'node:assert/strict';
import {oldAppProfileCleanupSql,oldAppOrderCleanupSql,oldAppCleanupAllowed} from './delivery-old-app-cleanup.mjs';
const id='abcdef78-1234-4123-8123-123456789012';
test('cleanup only accepts a canonical owned profile and guards future foreign references',()=>{
 const sql=oldAppProfileCleanupSql(id);
 for(const guard of ['preview-rotation-'+id+'@stallorder.invalid','FOR UPDATE','UNEXPECTED_SESSION_REFERENCE',
  'UNEXPECTED_PROFILE_REFERENCE','OWNED_CLEANUP_INCOMPLETE','auth_user_id IS NOT NULL'])assert.ok(sql.includes(guard));
 assert.ok(sql.indexOf('UNEXPECTED_PROFILE_REFERENCE')<sql.indexOf('DELETE FROM public.profiles'));
 assert.ok(!sql.includes('DELETE FROM public.rate_limit_buckets'));
 assert.ok(!sql.includes('CASCADE'));
});
test('cleanup rejects absent or injected identifiers before SQL construction',()=>{
 for(const value of [undefined,'',"x'; DROP TABLE public.profiles; --",'a'.repeat(36),id.toUpperCase()])assert.throws(()=>oldAppProfileCleanupSql(value));
});
test('QR cleanup covers owned sessions and audits without rewinding shared counters or rate buckets',()=>{
 const sql=oldAppOrderCleanupSql({qrId:id,orderId:'12345678-1234-4123-8123-123456789012',note:'Credential rehearsal 123 '+id});
 for(const guard of ['FOR UPDATE','OWNED_ORDER_PREIMAGE_MISMATCH','UNEXPECTED_QR_REFERENCE','DELETE FROM public.order_sessions',
  'DELETE FROM public.public_order_attempts','PUBLIC_ORDER_CREATED','OWNED_QR_CLEANUP_INCOMPLETE'])assert.ok(sql.includes(guard));
 assert.ok(!sql.includes('stall_order_counters'));assert.ok(!sql.includes('rate_limit_buckets'));
 assert.throws(()=>oldAppOrderCleanupSql({qrId:id,orderId:id,note:"' unsafe"}));
});
test('unknown HTTP/DB outcomes or an open browser forbid fixture deletion',()=>{
 const settled={browserStopped:true,pendingRequests:0,unknownRequest:false,databaseWritePending:false};
 assert.equal(oldAppCleanupAllowed(settled),true);
 for(const change of [{browserStopped:false},{pendingRequests:1},{unknownRequest:true},{databaseWritePending:true},{browserStopped:undefined},{pendingRequests:undefined}])
  assert.equal(oldAppCleanupAllowed({...settled,...change}),false);
});
