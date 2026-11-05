import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyUsageInboundReferences} from './delivery-edge-usage-references.mjs';
const owned={organizationId:'11111111-1111-4111-8111-111111111111',
  stallId:'22222222-2222-4222-8222-222222222222',orderId:'33333333-3333-4333-8333-333333333333',
  productId:'44444444-4444-4444-8444-444444444444'};
const columns=new Map([['orders',['organization_id','stall_id']],['products',['organization_id']],
  ['order_items',['organization_id']]]);
function fixture({source='order_items',target='orders',column='order_id',foreign=0}={}) {
  const calls=[];
  return {calls,db:{$queryRawUnsafe:async(sql,...args)=>{
    calls.push({sql,args});
    if(sql.includes('pg_constraint'))return [{source_schema:'public',source_table:source,target_schema:'public',
      target_table:target,source_columns:[column],target_columns:['id'],constraint_name:source+'_'+column+'_fkey'}];
    return [{foreign_count:foreign}];
  }}};
}
for(const [label,args]of [
  ['foreign order item CASCADE',{foreign:1}],
  ['foreign product reference SET NULL',{target:'products',column:'product_id',foreign:1}],
  ['unowned merchant application SET NULL',{source:'merchant_applications',target:'organizations',column:'approved_organization_id',foreign:1}],
])test('refuses '+label+' before fixture deletion',async()=>{
  const f=fixture(args);await assert.rejects(()=>verifyUsageInboundReferences(f.db,owned,columns),/EDGE_USAGE_FOREIGN_INBOUND_REFERENCE/);
  assert.equal(f.calls.length,2);
  assert.match(f.calls[1].sql,/JOIN public\."/);
});
test('checks parent references even when the child owner would exclude them from tenant inventory',async()=>{
  const f=fixture();await verifyUsageInboundReferences(f.db,owned,columns);
  const query=f.calls[1];
  assert.match(query.sql,/child\."order_id"=parent\."id"/);
  assert.match(query.sql,/parent\."organization_id"=\$1::uuid/);
  assert.match(query.sql,/NOT COALESCE\(/);
  assert.match(query.sql,/child\."organization_id"=\$1::uuid/);
  assert.ok(query.args.includes(owned.orderId)&&query.args.includes(owned.productId));
});
test('new unscoped references fail closed and malformed catalog identifiers never become SQL',async()=>{
  const f=fixture({source:'unknown_links',foreign:1});
  await assert.rejects(()=>verifyUsageInboundReferences(f.db,owned,columns),/EDGE_USAGE_FOREIGN_INBOUND_REFERENCE/);
  assert.match(f.calls[1].sql,/NOT COALESCE\(\(false\),false\)/);
  const bad=fixture({source:'unsafe"table'});
  await assert.rejects(()=>verifyUsageInboundReferences(bad.db,owned,columns));
  assert.equal(bad.calls.length,1);
});
test('legacy attempt tenant FK requires matching canonical organization before reconciliation',async()=>{
  const f=fixture({source:'public_order_attempts',target:'organizations',column:'tenant_id'});
  await verifyUsageInboundReferences(f.db,owned,columns);
  assert.match(f.calls[1].sql,/child\."tenant_id"=\$1::uuid/);
  assert.match(f.calls[1].sql,/child\."organization_id"=\$1::uuid/);
});
test('known attempt column with a different FK target is not exempt from ownership',async()=>{
  const f=fixture({source:'public_order_attempts',target:'orders',column:'order_session_id'});
  await verifyUsageInboundReferences(f.db,owned,columns);
  assert.match(f.calls[1].sql,/NOT COALESCE\(\(false\),false\)/);
});
