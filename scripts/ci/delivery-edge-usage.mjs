import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {previewPublicOrigins} from './delivery-preview-deployment.mjs';
import {createRatePeriodLedger, recordRatePeriods, verifyRateExpiry} from './delivery-edge-rate-expiry.mjs';
import {validateUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {verifyUsageInboundReferences} from './delivery-edge-usage-references.mjs';
import {discoverRecoveryUsageIdentity} from './delivery-edge-usage-recovery.mjs';

const project = 'teunnvfakbfzmodajqjz';
const allowedTables = new Set(['subscriptions', 'stalls', 'stall_ordering_settings', 'stall_business_hours',
  'product_categories', 'products', 'stall_products', 'qr_codes', 'stall_capacity_settings', 'kitchen_stations',
  'pickup_display_settings', 'orders', 'order_items', 'order_events', 'order_sessions', 'public_order_attempts',
  'public_rate_limit_buckets', 'stall_order_counters', 'audit_logs',
  'operational_events', 'daily_stall_summaries']);
const iso = value => new Date(value).toISOString();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function verifyUsageOperationalEvents(events, owned) {
  assert.ok(events.length <= 2 && events.every(event => event.stallId === owned.stallId
    && event.entityType === 'ORDER' && event.entityId === owned.orderId
    && event.eventType === 'ORDER_CREATED'), 'EDGE_USAGE_FOREIGN_EVENT');
}

export async function reconcileUsageAttempts(tx, owned, calls, recoverInterrupted = false) {
  const requestIds = calls.map(call => call.requestId);
  const sessionIds = owned.orderSessionIds ?? [];
  assert.ok(sessionIds.length <= 1);
  for (const id of sessionIds) assert.match(id, uuid);
  assert.equal(new Set(requestIds).size, requestIds.length);
  for (const id of requestIds) assert.match(id, uuid);
  const where = {OR: [{organizationId: owned.organizationId}, {stallId: owned.stallId},
    {qrCodeId: owned.qrId}, {orderSessionId: {in: sessionIds}}, {requestId: {in: requestIds}}]};
  const select = {id: true, requestId: true, organizationId: true, stallId: true, qrCodeId: true,
    orderSessionId: true, eventType: true, outcome: true, reasonCode: true};
  const before = await tx.publicOrderAttempt.findMany({where, select});
  assert.ok(before.length <= 100);
  for (const row of before) {
    assert.ok(!recoverInterrupted || row.organizationId === owned.organizationId,
      'EDGE_USAGE_RECOVERY_UNKNOWN_ATTEMPT');
    assert.match(row.id, uuid);
    assert.ok(requestIds.includes(row.requestId) && [null, owned.organizationId].includes(row.organizationId)
      && [null, owned.stallId].includes(row.stallId) && [null, owned.qrId].includes(row.qrCodeId)
      && [null, ...sessionIds].includes(row.orderSessionId),
    'EDGE_USAGE_FOREIGN_ATTEMPT');
  }
  const deleted = await tx.publicOrderAttempt.deleteMany({where: {
    id: {in: before.map(row => row.id)}, requestId: {in: requestIds},
  }});
  assert.equal(deleted.count, before.length, 'EDGE_USAGE_ATTEMPT_CHANGED');
  const after = await tx.publicOrderAttempt.findMany({where, select});
  assert.equal(after.length, 0, 'EDGE_USAGE_ATTEMPT_REMAINS');
  return {before, afterCount: after.length};
}

export async function inventoryUsageFixtures(db, owned) {
  const columns = await db.$queryRawUnsafe(`select table_name, column_name from information_schema.columns
    where table_schema='public' and column_name in ('organization_id','stall_id') order by table_name,column_name`);
  const tables = new Map();
  for (const row of columns) {
    assert.match(row.table_name, /^[a-z][a-z0-9_]*$/);
    assert.ok(['organization_id','stall_id'].includes(row.column_name));
    if (!tables.has(row.table_name)) tables.set(row.table_name, []);
    tables.get(row.table_name).push(row.column_name);
  }
  assert.ok(tables.size > 20 && tables.size < 200);
  const counts = {};
  for (const [table, names] of tables) {
    const matches = names.map((column,i)=>`"${column}"=$${i+1}::uuid`).join(' OR ');
    const foreign = names.map((column,i)=> {
      // Global attempts are separately reconciled against received request IDs.
      // Other rows must retain an exact organization owner before any CASCADE
      // or SET NULL can erase a mixed/ownerless reference to the fixture stall.
      const nullable = column !== 'organization_id' || table === 'public_order_attempts';
      return `${nullable ? `"${column}" IS NOT NULL AND ` : ''}"${column}" IS DISTINCT FROM $${i+1}::uuid`;
    }).join(' OR ');
    const [row] = await db.$queryRawUnsafe(`select count(*)::int as n,
      count(*) FILTER (WHERE ${foreign})::int as foreign_count
      from public."${table}" where ${matches}`,
    ...names.map(column=>column==='organization_id'?owned.organizationId:owned.stallId));
    assert.equal(row.foreign_count,0,'EDGE_USAGE_FOREIGN_REFERENCE');
    counts[table] = row.n;
  }
  counts.organizations = await db.organization.count({where: {id: owned.organizationId}});
  counts.staff_push_deliveries = await db.staffPushDelivery.count({where: {orderId: owned.orderId}});
  await verifyUsageInboundReferences(db, owned, tables);
  return counts;
}
async function prepare(db, owned) {
  await db.$transaction(async tx => {
    const plan = await tx.planVersion.findFirstOrThrow({where: {plan: {code: 'TRIAL'}, effectiveUntil: null}});
    const now = new Date(), end = new Date(now.getTime() + 86400000);
    await tx.organization.create({data: {id: owned.organizationId, name: owned.prefix, slug: owned.prefix,
      businessName: '隔離還原合成驗收', status: 'ACTIVE', email: owned.prefix + '@stallorder.test', phone: '0900000000'}});
    await tx.subscription.create({data: {id: owned.subscriptionId, organizationId: owned.organizationId,
      planId: plan.planId, planVersionId: plan.id, status: 'ACTIVE', billingInterval: 'MONTHLY',
      billingPeriodStart: now, billingPeriodEnd: end}});
    await tx.stall.create({data: {id: owned.stallId, organizationId: owned.organizationId, name: owned.prefix,
      slug: owned.prefix, code: owned.prefix, address: '合成測試，禁止配送', location: '隔離驗收',
      isActive: true, businessStatus: 'OPEN', orderingState: 'OPEN', orderingEnabled: true, isSoldOut: false}});
    await tx.stallOrderingSettings.create({data: {organizationId: owned.organizationId, stallId: owned.stallId,
      deliveryModuleEnabled: true, printModuleEnabled: false, kdsModuleEnabled: false, paymentModuleEnabled: false,
      discountModuleEnabled: false, lotteryEnabled: false, orderWindowSeconds: 300, enabledLocales: ['zh-TW']}});
    await tx.stallCapacitySettings.update({where: {stallId: owned.stallId}, data: {
      isActive: false, autoPauseEnabled: false, autoResumeEnabled: false}});
    await tx.stallBusinessHour.createMany({data: Array.from({length: 7}, (_, dayOfWeek) => ({
      id: owned.hourIds[dayOfWeek], organizationId: owned.organizationId, stallId: owned.stallId,
      dayOfWeek, opensAt: '00:00', closesAt: '00:00', lastOrderAt: null, isClosed: false}))});
    await tx.productCategory.create({data: {id: owned.categoryId, organizationId: owned.organizationId, name: '合成測試'}});
    await tx.product.create({data: {id: owned.productId, organizationId: owned.organizationId,
      categoryId: owned.categoryId, name: '隔離驗收餐', description: '禁止製作、付款、通知或配送', defaultPrice: 1}});
    await tx.stallProduct.create({data: {id: owned.stallProductId, organizationId: owned.organizationId,
      stallId: owned.stallId, productId: owned.productId, isEnabled: true, isSoldOut: false, stockRemaining: null}});
    await tx.qrCode.create({data: {id: owned.qrId, organizationId: owned.organizationId, stallId: owned.stallId,
      token: owned.qrToken, label: owned.prefix, state: 'ACTIVE', tokenVersion: 1}});
  }, {isolationLevel: 'Serializable', timeout: 30000});
}
async function cleanup(db, owned, calls, recoverInterrupted = false) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='3s'");
    for (const [table,id] of [['organizations',owned.organizationId],['stalls',owned.stallId],
      ['qr_codes',owned.qrId],['orders',owned.orderId],['products',owned.productId],
      ['product_categories',owned.categoryId],['subscriptions',owned.subscriptionId],
      ...(owned.orderSessionIds??[]).map(id=>['order_sessions',id])]) {
      assert.match(id,uuid);
      await tx.$queryRawUnsafe(`SELECT id FROM public."${table}" WHERE id=$1::uuid FOR UPDATE`,id);
    }
    if (recoverInterrupted) {
      const identity = await discoverRecoveryUsageIdentity(tx, owned);
      owned.orderSessionIds = identity.orderSessionIds;
      // These correlations come from locked, owned DB rows. They never become
      // HTTP calls or satisfy the normal five-call usage receipt.
      calls = identity.databaseObservedRequestIds.map(requestId => ({requestId}));
    }
    const before = await inventoryUsageFixtures(tx, owned);
    if (before.organizations === 0) {
      assert.ok(Object.values(before).every(n => n === 0));
      const attempts = await reconcileUsageAttempts(tx, owned, calls, recoverInterrupted);
      return {before, after: before, attempts};
    }
    const org = await tx.organization.findUniqueOrThrow({where: {id: owned.organizationId}});
    assert.equal(org.slug, owned.prefix); assert.equal(org.email, owned.prefix + '@stallorder.test');
    for (const [table, count] of Object.entries(before)) {
      assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 100);
      if (table !== 'organizations' && !allowedTables.has(table)) assert.equal(count, 0, 'EDGE_USAGE_UNEXPECTED_SIDE_EFFECT');
    }
    for (const [model, id] of [['stall', owned.stallId], ['subscription', owned.subscriptionId],
      ['product', owned.productId], ['productCategory', owned.categoryId], ['qrCode', owned.qrId], ['order', owned.orderId]]) {
      const rows = await tx[model].findMany({where: {organizationId: owned.organizationId}, select: {id: true}});
      assert.ok(rows.length <= 1 && rows.every(row => row.id === id), 'EDGE_USAGE_FOREIGN_FIXTURE_ROW');
    }
    const events = await tx.operationalEvent.findMany({where: {organizationId: owned.organizationId},
      select: {stallId: true, entityType: true, entityId: true, eventType: true}});
    verifyUsageOperationalEvents(events, owned);
    const sessions=await tx.orderSession.findMany({where:{OR:[{organizationId:owned.organizationId},
      {stallId:owned.stallId},{qrCodeId:owned.qrId}]},select:{id:true,organizationId:true,stallId:true,qrCodeId:true}});
    assert.ok(sessions.length<=1&&sessions.every(row=>(owned.orderSessionIds??[]).includes(row.id)
      && row.organizationId===owned.organizationId&&row.stallId===owned.stallId&&row.qrCodeId===owned.qrId),
    'EDGE_USAGE_UNKNOWN_SESSION');
    const attempts = await reconcileUsageAttempts(tx, owned, calls, recoverInterrupted);
    await tx.auditLog.deleteMany({where: {organizationId: owned.organizationId}});
    await tx.orderSession.deleteMany({where: {id:{in:owned.orderSessionIds??[]},
      organizationId: owned.organizationId, stallId: owned.stallId, qrCodeId:owned.qrId}});
    await tx.order.deleteMany({where: {id: owned.orderId, organizationId: owned.organizationId, stallId: owned.stallId}});
    await tx.operationalEvent.deleteMany({where: {organizationId: owned.organizationId, stallId: owned.stallId,
      entityType: 'ORDER', entityId: owned.orderId}});
    await tx.dailyStallSummary.deleteMany({where: {organizationId: owned.organizationId, stallId: owned.stallId}});
    await tx.qrCode.deleteMany({where: {id: owned.qrId, organizationId: owned.organizationId}});
    await tx.stall.deleteMany({where: {id: owned.stallId, organizationId: owned.organizationId}});
    await tx.product.deleteMany({where: {id: owned.productId, organizationId: owned.organizationId}});
    await tx.productCategory.deleteMany({where: {id: owned.categoryId, organizationId: owned.organizationId}});
    await tx.subscription.deleteMany({where: {id: owned.subscriptionId, organizationId: owned.organizationId}});
    await tx.organization.delete({where: {id: owned.organizationId}});
    const after = await inventoryUsageFixtures(tx, owned); assert.ok(Object.values(after).every(n => n === 0));
    return {before, after, attempts};
  }, {isolationLevel: 'Serializable', timeout: 30000});
}
// Independent recovery only. Parent locks and all existing ownership/inbound
// checks still apply. Shared global attempts/rate rows are retained; a DB
// readback cannot prove that an unanswered Edge request has stopped.
export async function recoverIsolatedUsageFixtures({db, runId, owned}) {
  validateUsageFixture(owned, runId);
  owned = structuredClone(owned);
  const fixtureCleanup = await cleanup(db, owned, [], true);
  return {schema: 'stallorder-isolated-edge-owned-recovery/v1', project, runId,
    ownedOrganizationId: owned.organizationId, ownedStallId: owned.stallId,
    ownedOrderId: owned.orderId, ownedOrderSessionIds: owned.orderSessionIds ?? [],
    fixtureCleanup, ownedRowsRemainingAtReadback: 0, sharedRowsDeleted: 0,
    requestsSettled: null, globalAttemptsReconciled: null, sharedRateEffectsSettled: null,
    cleanupVerified: false, productQualified: false, releaseAuthorized: false};
}

async function rateSnapshot(db, ledger) {
  const [row] = await db.$queryRawUnsafe(`select statement_timestamp() as observed,
    (select coalesce(jsonb_agg(to_jsonb(b) order by b.key),'[]'::jsonb)
       from (select key,scope,count,expires_at,updated_at from public.rate_limit_buckets order by key limit 20001) b) as buckets`);
  const snapshot = {observedAt: iso(row.observed), rows: row.buckets.map(b => ({key: b.key, scope: b.scope,
    count: b.count, expiresAt: iso(b.expires_at), updatedAt: iso(b.updated_at)}))};
  recordRatePeriods(ledger, snapshot);
  return snapshot;
}
// Called only by the reviewed protected paired-project entry. No CLI, target
// selection, runtime configuration changes, external messaging or payment calls.
export async function verifyIsolatedEdgeUsage({db, origin, anonKey, runId, owned, request = fetch, wait = delay}) {
  assert.equal(previewPublicOrigins(origin), origin);
  assert.match(runId ?? '', /^[1-9][0-9]*$/); assert.ok(typeof anonKey === 'string' && anonKey.length > 20);
  validateUsageFixture(owned,runId);
  owned=structuredClone(owned);
  const ledger = createRatePeriodLedger(), calls = [];
  let failed = false, cleanupReceipt, rateReceipt, outcomeUnknown = false, rateEvidenceComplete = true;
  const failureStages = [];
  async function call(slug, body) {
    try {await rateSnapshot(db, ledger);} catch {rateEvidenceComplete = false; throw new Error('EDGE_USAGE_RATE_BEFORE_FAILED');}
    let response, data, responded = false;
    let requestId;
    try {
      response = await request(`https://${project}.supabase.co/functions/v1/${slug}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: {apikey: anonKey, Authorization: 'Bearer ' + anonKey, Origin: origin,
          'Content-Type': 'application/json', 'x-stallorder-protocol-version': '1',
          'x-stallorder-operation-id': randomUUID(), 'x-stallorder-device-id': owned.deviceId},
        body: JSON.stringify(body)});
      requestId = response.headers.get('x-request-id');
      assert.match(requestId ?? '', uuid);
      calls.push({slug, status: response.status, requestId, observedAt: ledger.lastObservedAt});
      responded = true;
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; assert.ok(size <= 1024 * 1024, 'EDGE_USAGE_RESPONSE_TOO_LARGE'); chunks.push(chunk);
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      if (!responded) outcomeUnknown = true;
      try {await rateSnapshot(db, ledger);} catch {rateEvidenceComplete = false; throw new Error('EDGE_USAGE_RATE_AFTER_FAILED');}
    }
    assert.ok([200, 201].includes(response.status), 'EDGE_USAGE_HTTP_FAILED');
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));
    return {data, requestId};
  }
  try {
    await prepare(db, owned);
    const issued = await call('create-order-session', {qrToken: owned.qrToken, deviceId: owned.deviceId,
      orderingMode: 'DELIVERY', sessionRequestId: owned.sessionRequestId, includeMenu: true});
    assert.equal(issued.data.orderingMode, 'DELIVERY'); assert.equal(issued.data.orderingOpenNow, true);
    assert.match(issued.data.orderSessionToken ?? '', /^stos_[A-Za-z0-9_-]{43}$/);
    const session=await db.orderSession.findUniqueOrThrow({where:{tokenHash:createHash('sha256')
      .update(issued.data.orderSessionToken).digest('hex')},select:{id:true,organizationId:true,
      stallId:true,qrCodeId:true,orderingMode:true}});
    assert.match(session.id,uuid);
    assert.equal(session.organizationId,owned.organizationId);assert.equal(session.stallId,owned.stallId);
    assert.equal(session.qrCodeId,owned.qrId);assert.equal(session.orderingMode,'DELIVERY');
    owned.orderSessionIds=[session.id];
    const submitted = await call('create-public-order', {qrToken: owned.qrToken, deviceId: owned.deviceId,
      orderingMode: 'DELIVERY', orderSessionToken: issued.data.orderSessionToken, clientOrderId: owned.orderId,
      idempotencyKey: owned.idempotencyKey, turnstileIdempotencyKey: owned.turnstileIdempotencyKey,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', customerName: owned.prefix, customerPhone: '0900000000',
      deliveryAddress: '隔離驗收合成資料，禁止配送', waitAcknowledged: true, items: [{productId: owned.productId, quantity: 1}]});
    assert.equal(submitted.data.orderStatus, 'WAITING_CONFIRMATION'); assert.equal(submitted.data.fulfillmentType, 'DELIVERY');
    const order = await db.order.findUniqueOrThrow({where: {id: owned.orderId}});
    assert.equal(order.organizationId, owned.organizationId); assert.equal(order.stallId, owned.stallId);
    assert.equal(order.source, 'LINE_DELIVERY'); assert.equal(order.status, 'WAITING_CONFIRMATION');
    assert.equal(order.pickupCodeHash, null); assert.equal(order.paymentStatus, 'UNPAID');
    const tracking = {trackingToken: submitted.data.trackingToken, deviceId: owned.deviceId};
    const tracked = await call('get-public-order', tracking);
    assert.equal(tracked.data.order.orderStatus, 'WAITING_CONFIRMATION'); assert.equal(tracked.data.order.fulfillmentType, 'DELIVERY');
    const status = await call('manage-line-link', {...tracking, action: 'STATUS'});
    assert.equal(status.data.linked, false); assert.equal(typeof status.data.repeatOrderAvailable, 'boolean');
    const reorder = await call('prepare-reorder', tracking);
    assert.equal(reorder.data.orderingMode, 'DELIVERY'); assert.equal(reorder.data.qrToken, owned.qrToken);
    assert.equal(reorder.data.orderPath, `/store/${encodeURIComponent(owned.prefix)}?view=delivery`);
    assert.ok(reorder.data.availableItems.some(item => item.productId === owned.productId && item.quantity === 1));
    const attempts = await db.publicOrderAttempt.findMany({where: {organizationId: owned.organizationId},
      select: {requestId: true, eventType: true, reasonCode: true}});
    assert.ok(attempts.some(a => a.requestId === issued.requestId && a.reasonCode === 'SESSION_ISSUED'));
    assert.ok(attempts.some(a => a.requestId === submitted.requestId && a.reasonCode === 'ORDER_CREATED'));
  } catch {failed = true; failureStages.push('usage');}
  finally {
    try {cleanupReceipt = await cleanup(db, owned, calls);} catch {failed = true; failureStages.push('fixture-cleanup');}
    try {if (!outcomeUnknown && rateEvidenceComplete && ledger.snapshots.length) {
      const deadline = Date.now() + 10 * 60000;
      // Preserve shared rows, including unknown traffic. Wait only for periods
      // observed around our completed requests; never extend or relabel them.
      while (Date.now() < deadline) {
        const [time] = await db.$queryRawUnsafe('select statement_timestamp() as observed');
        try {rateReceipt = verifyRateExpiry(ledger, iso(time.observed), true); break;}
        catch (error) {if (error.message !== 'EDGE_USAGE_RATE_PERIOD_ACTIVE') throw error;}
        await wait(5000);
      }
    }} catch {failed = true; failureStages.push('rate-finalization');}
  }
  const receipt = {schema: 'stallorder-isolated-five-edge-usage/v1', project, runId,
    ownedOrganizationId: owned.organizationId, ownedStallId: owned.stallId, ownedOrderId: owned.orderId,
    ownedOrderSessionIds:owned.orderSessionIds??[],
    calls, fixtureCleanup: cleanupReceipt ?? null, rateCleanup: rateReceipt ?? null, failureStages,
    rateEvidenceComplete, rateSnapshots: ledger.snapshots,
    ownedFixtureRowsRemaining: cleanupReceipt && !outcomeUnknown ? 0 : null, requestsSettled: !outcomeUnknown,
    releaseAuthorized: false};
  receipt.evidenceSha256 = digest(receipt);
  if (failed || !cleanupReceipt || !rateReceipt || calls.length !== 5) {
    const error = new Error('EDGE_USAGE_OR_CLEANUP_FAILED'); error.receipt = receipt; throw error;
  }
  return receipt;
}
