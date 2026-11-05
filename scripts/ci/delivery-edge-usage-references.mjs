import assert from 'node:assert/strict';

const identifier = name => {assert.match(name ?? '', /^[a-z][a-z0-9_]*$/); return '"' + name + '"';};
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
// The caller holds the fixture parent locks in its Serializable cleanup
// transaction. Tenant inventory alone cannot see a foreign row whose separate
// CASCADE/SET NULL foreign key references an owned order, product or parent.
export async function verifyUsageInboundReferences(db, owned, columns) {
  const values = [owned.organizationId, owned.stallId];
  for (const id of values) assert.match(id, uuid);
  const roots = new Map([['organizations', '$1::uuid'], ['stalls', '$2::uuid']]);
  for (const [table, field] of [['orders','orderId'], ['products','productId'],
    ['product_categories','categoryId'], ['subscriptions','subscriptionId'], ['qr_codes','qrId']]) {
    if (owned[field] !== undefined) {assert.match(owned[field], uuid); values.push(owned[field]); roots.set(table, `$${values.length}::uuid`);}
  }
  const references = await db.$queryRawUnsafe(`SELECT sn.nspname AS source_schema, sc.relname AS source_table,
    pn.nspname AS target_schema, pc.relname AS target_table, c.conname AS constraint_name,
    array_agg(sa.attname::text ORDER BY k.n) AS source_columns,
    array_agg(pa.attname::text ORDER BY k.n) AS target_columns
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class sc ON sc.oid=c.conrelid
    JOIN pg_catalog.pg_namespace sn ON sn.oid=sc.relnamespace
    JOIN pg_catalog.pg_class pc ON pc.oid=c.confrelid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=pc.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(src,dst,n)
    JOIN pg_catalog.pg_attribute sa ON sa.attrelid=sc.oid AND sa.attnum=k.src
    JOIN pg_catalog.pg_attribute pa ON pa.attrelid=pc.oid AND pa.attnum=k.dst
    WHERE c.contype='f' AND pn.nspname='public'
    GROUP BY c.oid,sn.nspname,sc.relname,pn.nspname,pc.relname,c.conname ORDER BY c.oid`);
  assert.ok(Array.isArray(references) && references.length <= 1000);
  const checks = [];
  for (const ref of references) {
    for (const key of ['source_schema','source_table','target_schema','target_table','constraint_name']) identifier(ref[key]);
    assert.equal(ref.target_schema, 'public');
    assert.ok(Array.isArray(ref.source_columns) && ref.source_columns.length > 0 && ref.source_columns.length <= 8);
    assert.ok(Array.isArray(ref.target_columns) && ref.target_columns.length === ref.source_columns.length);
    const joins = ref.source_columns.map((name,i) => `child.${identifier(name)}=parent.${identifier(ref.target_columns[i])}`);
    const parentColumns = columns.get(ref.target_table) ?? [];
    const scope = parentColumns.map(name => {
      assert.ok(['organization_id','stall_id'].includes(name));
      return `parent.${identifier(name)}=$${name==='organization_id'?1:2}::uuid`;
    });
    if (roots.has(ref.target_table)) scope.push(`parent."id"=${roots.get(ref.target_table)}`);
    if (!scope.length) continue;
    const childColumns = ref.source_schema === 'public' ? columns.get(ref.source_table) ?? [] : [];
    let ownership = childColumns.map(name => {
      assert.ok(['organization_id','stall_id'].includes(name));
      return `${name==='stall_id'?'(child."stall_id" IS NULL OR ':''}child.${identifier(name)}=$${name==='organization_id'?1:2}::uuid${name==='stall_id'?')':''}`;
    });
    // A row with only a stall owner must actually belong to that stall.
    if (childColumns.length === 1 && childColumns[0] === 'stall_id') ownership = ['child."stall_id"=$2::uuid'];
    if (ref.source_schema === 'public' && ref.source_table === 'order_items') {
      assert.ok(roots.has('orders') && roots.has('products'));
      ownership.push(`child."order_id"=${roots.get('orders')}`, `child."product_id"=${roots.get('products')}`);
    }
    // Nullable attempt references are separately matched to received request
    // IDs by reconcileUsageAttempts before any delete. Bind both sides of each
    // known FK; a familiar column pointing elsewhere must not inherit exemption.
    if (ref.source_schema === 'public' && ref.source_table === 'public_order_attempts') {
      const targets = {tenant_id:'organizations',organization_id:'organizations',
        stall_id:'stalls',qr_code_id:'qr_codes',order_session_id:'order_sessions'};
      const column = ref.source_columns[0];
      const known = ref.source_columns.length === 1 && ref.target_columns[0] === 'id'
        && targets[column] === ref.target_table;
      // The legacy tenant FK still exists. A legacy-only reference cannot be
      // found by canonical request reconciliation, so require both owners here.
      ownership = known ? column === 'tenant_id'
        ? ['child."tenant_id"=$1::uuid', 'child."organization_id"=$1::uuid'] : ['true'] : ['false'];
    }
    checks.push(`SELECT count(*) AS n FROM ${identifier(ref.source_schema)}.${identifier(ref.source_table)} child
      JOIN public.${identifier(ref.target_table)} parent ON ${joins.join(' AND ')}
      WHERE (${scope.join(' OR ')}) AND NOT COALESCE((${ownership.join(' AND ') || 'false'}),false)`);
  }
  if (!checks.length) return;
  const parameters = values.map((_,i) => `$${i+1}::uuid AS id_${i}`).join(',');
  const [result] = await db.$queryRawUnsafe(`WITH fixture_bind AS (SELECT ${parameters})
    SELECT coalesce(sum(n),0)::int AS foreign_count FROM (${checks.join('\nUNION ALL\n')}) inbound`, ...values);
  assert.equal(result.foreign_count, 0, 'EDGE_USAGE_FOREIGN_INBOUND_REFERENCE');
}
