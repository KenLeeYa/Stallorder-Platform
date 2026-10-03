import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertTarget } from './qa-pr366-preview-ui.mjs';

const org = '11111111-1111-4111-8111-111111111111';
const stall = '22222222-2222-4222-8222-222222222222';
const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);
const hoursFields = row => ({ opensAt: row.opensAt, closesAt: row.closesAt, lastOrderAt: row.lastOrderAt, isClosed: row.isClosed });
const seedOwnerId = '55555555-5555-4555-8555-555555555551';
function isSeedSupplyOverride(row, flagId, ownerId, instant) {
  return row?.flagId === flagId && row.scopeType === 'ORGANIZATION' && row.organizationId === org
    && row.stallId === null && row.deviceId === null && row.rolloutPercentage === null
    && row.enabled === true && row.reason === 'Local Supply Lite verification only'
    && ownerId === seedOwnerId && row.createdByProfileId === seedOwnerId && row.updatedByProfileId === seedOwnerId
    && (row.expiresAt === null || Date.parse(row.expiresAt) > instant);
}
export function fixtureFailureCode(error) {
  if (typeof error?.code === 'string' && /^P\d{4}$/.test(error.code)) return error.code;
  if (typeof error?.message === 'string' && /^FIXTURE_[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'UNCLASSIFIED';
}
export const MIDNIGHT_CASES = [
  ['before_open','2026-10-05T21:59:59+08:00','STALL_CLOSED'],
  ['opens_inclusive','2026-10-05T22:00:00+08:00',null],
  ['before_midnight','2026-10-05T23:59:59+08:00',null],
  ['after_midnight_today_closed','2026-10-06T00:00:00+08:00',null],
  ['overnight_tail','2026-10-06T01:59:59+08:00',null],
  ['closes_exclusive','2026-10-06T02:00:00+08:00','STALL_CLOSED'],
];

export function buildCalendarHours(before, mode, instant) {
  if (!['OPEN', 'CLOSED', 'OVERNIGHT', 'CUTOFF'].includes(mode)) throw Error('FIXTURE_HOURS_MODE_DENIED');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(part => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay();
  const time = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const rows = before.map(row => ({ ...row, opensAt: '00:00', closesAt: '00:00', lastOrderAt: null, isClosed: mode !== 'OPEN' }));
  if (mode === 'OVERNIGHT') {
    const row = rows.find(item => item.dayOfWeek === (minute < 720 ? (weekday + 6) % 7 : weekday));
    row.opensAt = minute < 720 ? '23:59' : time(minute - 60);
    row.closesAt = minute < 720 ? time(minute + 60) : '00:30'; row.isClosed = false;
  }
  if (mode === 'CUTOFF') {
    if (minute < 2 || minute >= 1438) throw Error('FIXTURE_CLOCK_BOUNDARY_PENDING');
    for (const row of rows) { row.isClosed = false; row.lastOrderAt = time(minute - 2); }
  }
  return rows;
}

export function assertDatabaseTarget(receipt, binding, databaseUrl, now = Date.now()) {
  assertTarget(receipt, binding, now);
  const url = new URL(databaseUrl);
  const proof = binding.readback.database;
  const direct = url.hostname === `db.${binding.childRef}.supabase.co` && url.username === 'postgres' && (!url.port || url.port === '5432');
  const identity = `${url.hostname}:${url.port || '5432'}/postgres|${decodeURIComponent(url.username)}`;
  const fingerprint = createHash('sha256').update(identity).digest('hex');
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username) === `postgres.${binding.childRef}`
    && proof?.username === decodeURIComponent(url.username) && String(proof?.port) === (url.port || '5432')
    && proof?.identityFingerprint === fingerprint;
  if (!proof || proof.projectRef !== binding.childRef || proof.host !== url.hostname
    || proof.ownerResourceKey !== receipt.resourceKey || proof.database !== 'postgres'
    || !['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== proof.host
    || url.pathname !== '/postgres' || !url.password || (!direct && !pooler)
    || url.searchParams.get('sslmode') !== 'require') throw Error('PREVIEW_DATABASE_TARGET_DENIED');
  return databaseUrl;
}

export async function runDatabaseFixture(receipt, binding, outDir, operation, input) {
  const actions = ['catalog-descriptor', 'verify-rejected-orders', 'prepare-ordering', 'restore-ordering', 'public-qr', 'prepare-pos-product', 'pos-descriptor', 'enable-circuit-b', 'restore-circuit-b', 'open-hours', 'closed-hours', 'overnight-hours', 'cutoff-hours', 'restore-hours', 'enable-supply', 'restore-supply',
    'dense-schedule', 'dense-workforce', 'dense-supply', 'dense-invoices', 'synthetic-invoices', 'inbox', 'inbox-readback', 'prepare-preorder', 'restore-preorder', 'inbox-membership', 'inbox-membership-readback', 'midnight-rollback'];
  if (!actions.includes(operation)) throw Error('FIXTURE_OPERATION_DENIED');
  const databaseUrl = process.env.PR366_CHILD_DATABASE_URL;
  if (!databaseUrl) throw Error('FIXTURE_CHILD_DATABASE_URL_REQUIRED');
  mkdirSync(outDir, { recursive: true });
  const output = resolve(outDir, `fixture-${operation}.json`);
  const save = async evidence => {
    writeFileSync(`${output}.tmp`, serialize(evidence), { mode: 0o600 });
    renameSync(`${output}.tmp`, output);
  };
  const privateDir = process.env.PR366_PRIVATE_FIXTURE_DIR;
  const savePrivate = privateDir ? async evidence => {
    mkdirSync(privateDir, { recursive: true });
    const path = resolve(privateDir, `fixture-${operation}.json`);
    writeFileSync(`${path}.tmp`, serialize(evidence), { mode: 0o600 }); renameSync(`${path}.tmp`, path);
  } : undefined;
  const tool = await createDatabaseFixtures({ receipt, binding, databaseUrl, save, savePrivate });
  try {
    if (operation === 'inbox-membership') return await tool.inboxMembership();
    if (operation === 'inbox-membership-readback') return await tool.inboxMembershipReadback(input);
    if (operation === 'midnight-rollback') return await tool.midnightRollback();
    if (operation === 'prepare-preorder') return await tool.preparePreorder();
    if (operation === 'restore-preorder') return await tool.restorePreorder(input);
    if (operation === 'verify-rejected-orders') return await tool.verifyRejectedOrders(input);
    if (operation === 'catalog-descriptor') return await tool.catalogDescriptor();
    if (operation === 'prepare-ordering') return await tool.prepareOrdering();
    if (operation === 'restore-ordering') return await tool.restoreOrdering(input);
    if (operation === 'public-qr') return await tool.publicQr();
    if (operation === 'prepare-pos-product') return await tool.preparePosProduct();
    if (operation === 'pos-descriptor') return await tool.posDescriptor();
    if (operation === 'enable-circuit-b') return await tool.enableCircuitB();
    if (operation === 'restore-circuit-b') return await tool.restoreCircuitB(input);
    if (operation === 'open-hours') return await tool.setHours('OPEN');
    if (operation === 'closed-hours') return await tool.setHours('CLOSED');
    if (operation === 'overnight-hours') return await tool.setHours('OVERNIGHT');
    if (operation === 'cutoff-hours') return await tool.setHours('CUTOFF');
    if (operation === 'restore-hours') return await tool.restoreHours(input);
    if (operation === 'enable-supply') return await tool.enableSupplyModule();
    if (operation === 'restore-supply') return await tool.restoreSupplyModule(input);
    if (operation === 'dense-schedule') return await tool.denseSchedules();
    if (operation === 'dense-workforce') return await tool.denseWorkforce();
    if (operation === 'dense-supply') return await tool.denseSupply();
    if (operation === 'synthetic-invoices') return await tool.syntheticInvoices();
    if (operation === 'inbox') return await tool.inbox();
    if (operation === 'inbox-readback') return await tool.inboxReadback(input);
    return await tool.denseInvoices(input);
  } finally { await tool.disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [receiptPath, bindingPath, outDir, operation, inputPath] = process.argv.slice(2);
  try {
    if (!receiptPath || !bindingPath || !outDir) throw Error('FIXTURE_ARGUMENTS_REQUIRED');
    await runDatabaseFixture(JSON.parse(readFileSync(receiptPath, 'utf8')), JSON.parse(readFileSync(bindingPath, 'utf8')),
      outDir, operation, inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')) : undefined);
  } catch (error) { process.stderr.write(`PREVIEW_FIXTURE_FAILED ${fixtureFailureCode(error)}; retain fixture receipt for recovery\n`); process.exitCode = 1; }
}

// Root supplies a fresh provider binding and executes this explicitly. No CLI, env lookup or local-helper retarget.
export async function createDatabaseFixtures({ receipt, binding, databaseUrl, save, savePrivate, now = Date.now, clientFactory }) {
  assertDatabaseTarget(receipt, binding, databaseUrl, now());
  if (typeof save !== 'function') throw Error('FIXTURE_RECEIPT_REQUIRED');
  const factory = clientFactory ?? (async url => {
    const { PrismaClient } = await import('@prisma/client');
    return new PrismaClient({ datasources: { db: { url } } });
  });
  const db = await factory(databaseUrl);
  const guard = () => assertDatabaseTarget(receipt, binding, databaseUrl, now());
  const where = { organizationId: org, stallId: stall };
  const marker = `PR366 ${receipt.resourceKey}`;
  const identity = { resourceKey: receipt.resourceKey, childRef: binding.childRef,
    deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, organizationId: org, stallId: stall, slug: 'aming-chicken' };
  const orderingSelect = { stallId: true, organizationId: true, updatedAt: true, deliveryModuleEnabled: true,
    staffDeliveryEnabled: true, printModuleEnabled: true, paymentModuleEnabled: true, kdsModuleEnabled: true };
  const orderingFields = row => ({ deliveryModuleEnabled: row.deliveryModuleEnabled, staffDeliveryEnabled: row.staffDeliveryEnabled,
    printModuleEnabled: row.printModuleEnabled, paymentModuleEnabled: row.paymentModuleEnabled, kdsModuleEnabled: row.kdsModuleEnabled });
  const preorderSelect = { stallId: true, organizationId: true, updatedAt: true, takeoutPreorderEnabled: true,
    preorderMinLeadMinutes: true, preorderMaxDays: true, preorderSlotMinutes: true, businessDayCutoffHour: true };
  const preorderFields = row => ({ takeoutPreorderEnabled: row.takeoutPreorderEnabled, preorderMinLeadMinutes: row.preorderMinLeadMinutes,
    preorderMaxDays: row.preorderMaxDays, preorderSlotMinutes: row.preorderSlotMinutes, businessDayCutoffHour: row.businessDayCutoffHour });
  async function parents() {
    guard();
    const [owner, shop] = await Promise.all([
      db.profile.findFirst({ where: { email: 'owner@stallorder.test', organizationMemberships: { some: { organizationId: org, isActive: true, role: { in: ['MERCHANT_OWNER', 'ORGANIZATION_OWNER'] } } } } }),
      db.stall.findFirst({ where: { id: stall, organizationId: org, slug: 'aming-chicken', timezone: 'Asia/Taipei' } }),
    ]);
    if (!owner || !shop) throw Error('FIXTURE_SEED_PARENT_DENIED');
    return { owner, shop };
  }
  async function batch(kind, rows, action, readback, relatedIds = {}) {
    guard();
    const evidence = { resourceKey: receipt.resourceKey, childRef: binding.childRef,
      deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, kind,
      marker, rows: rows.map(row => ({ id: row.id })), relatedIds, status: 'PLANNED', cleanup: 'RETAIN_AUDITED_PARENTS_UNTIL_CHILD_TEARDOWN' };
    await save(JSON.parse(serialize(evidence)));
    guard();
    await db.$transaction(action);
    const actual = await readback();
    if (actual.length !== rows.length || rows.some(row => !actual.some(found => found.id === row.id))) throw Error('FIXTURE_READBACK_FAILED');
    evidence.status = 'READBACK_VERIFIED';
    await save(JSON.parse(serialize(evidence)));
    return evidence;
  }
  return {
    async inboxMembership() {
      const { owner } = await parents();
      const staff = await db.profile.findFirst({ where: { email: 'staff@stallorder.test', isActive: true,
        stallMemberships: { some: { ...where, isActive: true, role: 'STAFF' } } } });
      if (!staff || staff.id === owner.id || staff.platformRole) throw Error('FIXTURE_NON_ADMIN_STAFF_REQUIRED');
      const existing = await db.organizationMembership.findMany({ where: { organizationId: org, profileId: staff.id } });
      if (existing.length) throw Error('FIXTURE_STAFF_EXISTING_ORG_MEMBERSHIP');
      const notice = await db.billingNotification.findFirst({ where: { organizationId: org, title: `${marker} 通知測試`, dismissedAt: null } });
      if (!notice) throw Error('FIXTURE_INBOX_REQUIRED');
      const row = { id: randomUUID(), organizationId: org, profileId: staff.id, role: 'FINANCE_VIEWER', allStalls: true, isPrimaryOwner: false, isActive: true };
      const evidence = { ...identity, kind: 'INBOX_MEMBERSHIP', status: 'PLANNED', membershipId: row.id,
        profileId: staff.id, ownerProfileId: owner.id, email: staff.email, role: row.role, isPrimaryOwner: false,
        notificationId: notice.id, title: notice.title, cleanup: 'RETAIN_AUDITED_MEMBERSHIP_UNTIL_CHILD_TEARDOWN' };
      await save(JSON.parse(serialize(evidence))); guard();
      await db.organizationMembership.create({ data: row });
      const actual = await db.organizationMembership.findFirst({ where: row });
      if (!actual) throw Error('FIXTURE_MEMBERSHIP_READBACK_FAILED');
      evidence.updatedAt = actual.updatedAt; evidence.status = 'READBACK_VERIFIED';
      await save(JSON.parse(serialize(evidence))); return evidence;
    },
    async inboxMembershipReadback(evidence) {
      guard();
      const fixture = binding.fixtures?.membership;
      if (!evidence || evidence.kind !== 'INBOX_MEMBERSHIP_REVOKED' || evidence.status !== 'API_REVOKE_VERIFIED'
        || ['resourceKey','childRef','deploymentId','sha','tree','organizationId'].some(key => evidence[key] !== identity[key])
        || evidence.sessionStillValid !== true || evidence.ownerStillAuthorized !== true
        || evidence.privateStateCleared !== true || !fixture || fixture.kind !== 'INBOX_MEMBERSHIP' || fixture.status !== 'READBACK_VERIFIED'
        || ['resourceKey','childRef','deploymentId','sha','tree','organizationId','membershipId','profileId','ownerProfileId','notificationId','email'].some(key => evidence[key] !== fixture[key])
        || evidence.email !== 'staff@stallorder.test' || !evidence.membershipId || !evidence.profileId) throw Error('FIXTURE_MEMBERSHIP_EVIDENCE_DENIED');
      const actual = await db.organizationMembership.findFirst({ where: { id: evidence.membershipId, organizationId: org,
        profileId: evidence.profileId, role: 'FINANCE_VIEWER', isPrimaryOwner: false, isActive: false }, include: { profile: true } });
      if (!actual || actual.profile.email !== evidence.email || !actual.profile.isActive) throw Error('FIXTURE_MEMBERSHIP_READBACK_FAILED');
      const result = { ...evidence, status: 'DB_REVOKE_VERIFIED' }; await save(result); return result;
    },
    async midnightRollback() {
      await parents();
      const before = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      if (before.length !== 7) throw Error('FIXTURE_SEVEN_HOURS_REQUIRED');
      const rollback = new Error('MIDNIGHT_INTENTIONAL_ROLLBACK');
      const results = [];
      let rolledBack = false;
      try {
        await db.$transaction(async tx => {
          guard();
          await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
          await tx.$queryRaw`SELECT id FROM public.stalls WHERE id=${stall}::uuid AND organization_id=${org}::uuid FOR UPDATE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM public.stall_business_hours WHERE stall_id=${stall}::uuid FOR UPDATE NOWAIT`;
          const shop = await tx.stall.findFirst({ where: { id: stall, organizationId: org, slug: 'aming-chicken', timezone: 'Asia/Taipei',
            isActive: true, orderingEnabled: true, isSoldOut: false, businessStatus: 'OPEN', orderingState: 'OPEN' } });
          if (!shop) throw Error('FIXTURE_OPEN_STALL_REQUIRED');
          const locked = await tx.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
          if (serialize(locked) !== serialize(before)) throw Error('FIXTURE_HOURS_CONCURRENT_CHANGE');
          const overlap = await tx.stallSpecialClosure.count({ where: { ...where, startsOn: { lte: new Date('2026-10-06') }, endsOn: { gte: new Date('2026-10-05') } } });
          if (overlap) throw Error('FIXTURE_MIDNIGHT_CLOSURE_OVERLAP');
          const qrs = await tx.qrCode.findMany({ where: { ...where, state: 'ACTIVE', expiresAt: { gt: new Date(now()) },
            diningTableId: null, locationId: null, stallScheduleId: null, marketEventId: null,
            OR: [{ label: `${marker} DEFAULT`, fulfillmentTypeContext: null }, { label: `${marker} DELIVERY`, fulfillmentTypeContext: 'DELIVERY' }] } });
          if (qrs.length !== 2 || qrs.filter(row => row.fulfillmentTypeContext === 'DELIVERY').length !== 1) throw Error('FIXTURE_EXACT_QRS_REQUIRED');
          const updated = await tx.stallBusinessHour.updateMany({ where, data: { opensAt: '22:00', closesAt: '02:00', lastOrderAt: null, isClosed: true } });
          if (updated.count !== 7) throw Error('FIXTURE_SEVEN_HOURS_REQUIRED');
          const monday = await tx.stallBusinessHour.updateMany({ where: { ...where, dayOfWeek: 1 }, data: { isClosed: false } });
          if (monday.count !== 1) throw Error('FIXTURE_MONDAY_REQUIRED');
          async function check(cases) {
            for (const qr of qrs) for (const [caseName, instant, expected] of cases) {
              const rows = await tx.$queryRaw`SELECT public.public_order_calendar_code(${qr.token},${new Date(instant)}::timestamptz) AS actual`;
              if (rows.length !== 1 || !Object.hasOwn(rows[0], 'actual')) throw Error('FIXTURE_CALENDAR_RESULT_INVALID');
              results.push({ mode: qr.fulfillmentTypeContext === 'DELIVERY' ? 'DELIVERY' : 'DEFAULT', caseName,
                actual: rows[0].actual, expected, passed: rows[0].actual === expected });
            }
          }
          await check(MIDNIGHT_CASES);
          await tx.stallBusinessHour.updateMany({ where: { ...where, dayOfWeek: 1 }, data: { lastOrderAt: '01:30' } });
          await check([['before_overnight_cutoff','2026-10-06T01:29:59+08:00',null], ['overnight_cutoff_inclusive','2026-10-06T01:30:00+08:00','QR_LAST_ORDER_PASSED']]);
          await tx.stallSpecialClosure.create({ data: { id: randomUUID(), ...where, startsOn: new Date('2026-10-06'), endsOn: new Date('2026-10-06'), title: `${marker} midnight rollback`, message: 'rollback-only' } });
          await check([['special_closed_date_overrides_yesterday_tail','2026-10-06T00:00:00+08:00','STALL_SPECIAL_CLOSURE']]);
          throw rollback;
        }, { timeout: 30_000 });
      } catch (error) { if (error !== rollback) throw error; rolledBack = true; }
      guard();
      const after = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      const closure = await db.stallSpecialClosure.count({ where: { ...where, title: `${marker} midnight rollback` } });
      const evidence = { ...identity, kind: 'MIDNIGHT_DB_CALENDAR', status: 'FAIL', rolledBack,
        originalHoursUnchanged: serialize(after) === serialize(before), closureAbsent: closure === 0, results,
        scope: 'DEPLOYED_DB_FUNCTION_EXPLICIT_CLOCK; NOT_LIVE_HTTP_MIDNIGHT_TRANSITION' };
      if (rolledBack && evidence.originalHoursUnchanged && evidence.closureAbsent && results.length === 18 && results.every(row => row.passed)) evidence.status = 'PASS';
      await save(evidence); if (evidence.status !== 'PASS') throw Error('FIXTURE_MIDNIGHT_PROOF_FAILED'); return evidence;
    },
    async preparePreorder() {
      await parents();
      const settings = await db.stallOrderingSettings.findFirst({ where, select: preorderSelect });
      const hours = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      if (!settings || hours.length !== 7 || hours.some((row, index) => row.dayOfWeek !== index)) throw Error('FIXTURE_PREORDER_SNAPSHOT_DENIED');
      const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(now())).map(part => [part.type, part.value]));
      const tomorrowDate = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day) + 1));
      const tomorrow = tomorrowDate.toISOString().slice(0, 10);
      const desiredSettings = { takeoutPreorderEnabled: true, preorderMinLeadMinutes: 15, preorderMaxDays: 2, preorderSlotMinutes: 30, businessDayCutoffHour: 0 };
      const desiredHours = hours.map(row => ({ ...row, opensAt: '17:00', closesAt: '23:00', lastOrderAt: null, isClosed: row.dayOfWeek !== tomorrowDate.getUTCDay() }));
      const evidence = { ...identity, kind: 'FUTURE_PREORDER', before: { settings, hours },
        after: { settings: desiredSettings, hours: desiredHours }, tomorrow, status: 'PLANNED' };
      await save(evidence); guard();
      await db.$transaction(async tx => {
        const changed = await tx.stallOrderingSettings.updateMany({ where: { ...where, updatedAt: settings.updatedAt, ...preorderFields(settings) }, data: desiredSettings });
        if (changed.count !== 1) throw Error('FIXTURE_PREORDER_CONCURRENT_CHANGE');
        for (const row of hours) {
          const result = await tx.stallBusinessHour.updateMany({ where: { ...where, id: row.id, updatedAt: row.updatedAt, ...hoursFields(row) }, data: hoursFields(desiredHours[row.dayOfWeek]) });
          if (result.count !== 1) throw Error('FIXTURE_PREORDER_CONCURRENT_CHANGE');
        }
      });
      const actualSettings = await db.stallOrderingSettings.findFirst({ where, select: preorderSelect });
      const actualHours = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      if (!actualSettings || serialize(preorderFields(actualSettings)) !== serialize(desiredSettings)
        || serialize(actualHours.map(hoursFields)) !== serialize(desiredHours.map(hoursFields))) throw Error('FIXTURE_PREORDER_READBACK_FAILED');
      // Read the actual canonical slot generator at database now(), rather than inventing a session or quote.
      const slotRows = await db.$queryRawUnsafe('select public.get_takeout_preorder_slots($1::uuid, now()) as slots', stall);
      const slots = Array.isArray(slotRows[0]?.slots) ? slotRows[0].slots.filter(value => typeof value === 'string'
        && Number.isFinite(Date.parse(value)) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) === tomorrow) : [];
      if (!slots.length || slots.some(value => Date.parse(value) <= now() + 15 * 60000)) throw Error('FIXTURE_PREORDER_CANONICAL_SLOT_REQUIRED');
      evidence.after = { settings: actualSettings, hours: actualHours };
      evidence.scheduledPickupAt = new Date(slots[0]).toISOString(); evidence.canonicalSlots = slots;
      evidence.currentHoursClosed = true; evidence.status = 'READBACK_VERIFIED';
      await save(evidence); return evidence;
    },
    async restorePreorder(evidence) {
      guard();
      if (evidence.resourceKey !== receipt.resourceKey || evidence.childRef !== binding.childRef || evidence.kind !== 'FUTURE_PREORDER'
        || evidence.status !== 'READBACK_VERIFIED' || evidence.before?.settings?.stallId !== stall
        || evidence.after?.settings?.stallId !== stall || evidence.before?.hours?.length !== 7 || evidence.after?.hours?.length !== 7) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
      await db.$transaction(async tx => {
        const changed = await tx.stallOrderingSettings.updateMany({ where: { ...where, updatedAt: new Date(evidence.after.settings.updatedAt),
          ...preorderFields(evidence.after.settings) }, data: preorderFields(evidence.before.settings) });
        if (changed.count !== 1) throw Error('FIXTURE_PREORDER_CONCURRENT_CHANGE');
        for (const row of evidence.after.hours) {
          const original = evidence.before.hours.find(item => item.id === row.id && item.dayOfWeek === row.dayOfWeek);
          if (!original) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
          const restored = await tx.stallBusinessHour.updateMany({ where: { ...where, id: row.id, updatedAt: new Date(row.updatedAt), ...hoursFields(row) }, data: hoursFields(original) });
          if (restored.count !== 1) throw Error('FIXTURE_PREORDER_CONCURRENT_CHANGE');
        }
      });
      const settings = await db.stallOrderingSettings.findFirst({ where, select: preorderSelect });
      const hours = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      if (!settings || serialize(preorderFields(settings)) !== serialize(preorderFields(evidence.before.settings))
        || serialize(hours.map(hoursFields)) !== serialize(evidence.before.hours.map(hoursFields))) throw Error('FIXTURE_RESTORE_READBACK_FAILED');
      await save({ ...identity, kind: 'FUTURE_PREORDER', status: 'RESTORED' });
    },
    async verifyRejectedOrders(evidence) {
      await parents();
      if (Object.entries({ resourceKey: receipt.resourceKey, childRef: binding.childRef, deploymentId: binding.deploymentId,
        sha: binding.sha, tree: binding.tree }).some(([key, value]) => evidence?.[key] !== value)
        || evidence.phase !== 'hours-closed' || evidence.status !== 'PASS' || evidence.results?.length !== 2
        || new Set(evidence.results.map(row => row.mode)).size !== 2
        || evidence.results.some(row => !['DEFAULT', 'DELIVERY'].includes(row.mode)
          || !/^[a-f0-9-]{36}$/i.test(row.rejectedCreateOrderId ?? '') || row.increaseUnchanged !== true || row.decreasedQuantity !== 1)
        || evidence.orderIds?.length !== 2 || new Set(evidence.orderIds).size !== 2) throw Error('FIXTURE_REJECTION_EVIDENCE_DENIED');
      const rejectedIds = evidence.results.map(row => row.rejectedCreateOrderId);
      if (new Set(rejectedIds).size !== 2 || evidence.orderIds.some(id => rejectedIds.includes(id))) throw Error('FIXTURE_REJECTION_EVIDENCE_DENIED');
      const rejected = await db.order.findMany({ where: { ...where, id: { in: rejectedIds } }, select: { id: true } });
      const existing = await db.order.findMany({ where: { ...where, id: { in: evidence.orderIds } }, include: { items: true } });
      if (rejected.length || existing.length !== 2 || evidence.orderIds.some(id => !existing.some(row => row.id === id
        && row.items?.length === 1 && row.items[0].quantity === 1))) throw Error('FIXTURE_REJECTION_READBACK_FAILED');
      const result = { ...identity, kind: 'CLOSED_ORDER_REJECTION', status: 'READBACK_VERIFIED',
        rejectedOrderIds: rejectedIds, retainedOrderIds: evidence.orderIds, retainedQuantity: 1 };
      await save(result); return result;
    },
    async inbox() {
      const { owner } = await parents();
      const row = { id: randomUUID(), organizationId: org, notificationType: 'PR366_SYNTHETIC_UI', severity: 'INFO',
        status: 'UNREAD', title: `${marker} 通知測試`, message: '隔離介面通知，無對外傳送。',
        dedupeKey: `${marker}-${randomUUID()}`, createdAt: new Date(now() - 1000) };
      const evidence = { ...identity, kind: 'INBOX', status: 'PLANNED', notificationId: row.id, profileId: owner.id,
        title: row.title, source: 'BILLING', scope: { kind: 'ORGANIZATION', organizationId: org },
        url: `${binding.origin}/notifications?kind=ORGANIZATION&organizationId=${org}` };
      await save(evidence); guard(); await db.billingNotification.create({ data: row });
      const actual = await db.billingNotification.findFirst({ where: { id: row.id, organizationId: org } });
      if (!actual || actual.title !== row.title || actual.dismissedAt || actual.status !== 'UNREAD') throw Error('FIXTURE_READBACK_FAILED');
      evidence.status = 'READBACK_VERIFIED'; await save(evidence); return evidence;
    },
    async inboxReadback(evidence) {
      await parents();
      if (evidence.resourceKey !== receipt.resourceKey || evidence.childRef !== binding.childRef || evidence.kind !== 'INBOX'
        || evidence.status !== 'READBACK_VERIFIED' || evidence.organizationId !== org || evidence.source !== 'BILLING') throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
      const owner = await db.profile.findFirst({ where: { id: evidence.profileId, email: 'owner@stallorder.test' } });
      const notification = await db.billingNotification.findFirst({ where: { id: evidence.notificationId, organizationId: org,
        title: evidence.title, notificationType: 'PR366_SYNTHETIC_UI' } });
      if (!owner || !notification) throw Error('FIXTURE_INBOX_OWNERSHIP_DENIED');
      const read = await db.notificationReadReceipt.findFirst({ where: { profileId: owner.id, billingNotificationId: notification.id } });
      if (!read?.readAt) throw Error('FIXTURE_INBOX_READ_NOT_PERSISTED');
      const result = { ...evidence, status: 'UI_READ_PERSISTED', readReceiptId: read.id, readAt: read.readAt };
      await save(result); return result;
    },
    async syntheticInvoices() {
      const { owner } = await parents();
      // Dedicated UI documents only: no provider operation, payment, notification or issuance call is made.
      const seller = await db.invoiceSellerProfile.findUnique({ where: { organizationId: org } });
      if (seller && seller.taxId !== 'TEST-ONLY') throw Error('FIXTURE_NON_MOCK_SELLER_DENIED');
      const connection = await db.invoiceProviderConnection.findFirst({ where: { organizationId: org, provider: 'ECPAY', environment: 'MOCK' } });
      const policy = await db.invoicePolicyVersion.findFirst({ where: { organizationId: org }, orderBy: { version: 'desc' } });
      if (policy && policy.defaultTaxType !== 'MOCK_NOT_TAX_DETERMINED') throw Error('FIXTURE_NON_MOCK_POLICY_DENIED');
      const sellerId = seller?.id ?? randomUUID(); const connectionId = connection?.id ?? randomUUID(); const policyId = policy?.id ?? randomUUID();
      const orders = Array.from({ length: 13 }, (_, i) => ({ id: randomUUID(), ...where,
        orderNo: `QA-${randomUUID()}`, trackingTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        idempotencyKey: randomUUID(), source: 'PR366_MOCK_INVOICE_UI', origin: 'TEST', isTest: true,
        customerName: `${marker} invoice ${i + 1}`, status: 'COMPLETED', paymentStatus: 'UNPAID',
        subtotal: 100, total: 100, deviceHash: createHash('sha256').update(marker).digest('hex'),
        confirmationExpiresAt: new Date(receipt.expiresAt), completedAt: new Date(now()) }));
      const docs = orders.map((order, i) => ({ id: randomUUID(), ...where, orderId: order.id,
        providerConnectionId: connectionId, sellerProfileId: sellerId, policyVersionId: policyId,
        documentType: 'ORIGINAL', status: 'ISSUED', salesAmount: 100, taxAmount: 0, totalAmount: 100,
        taxType: 'MOCK_NOT_TAX_DETERMINED', roundingPolicy: 'MOCK_NO_TAX', buyerType: 'PERSONAL',
        policySnapshotJson: { legalInvoice: false, fixture: marker }, sellerSnapshotJson: { legalInvoice: false, fixture: marker },
        buyerSnapshotJson: {}, testDocument: true, issuedAt: new Date(now()), externalInvoiceNumber: `TEST-${receipt.resourceKey}-${i}` }));
      return batch('DENSE_MOCK_INVOICE', docs, async tx => {
        if (!seller) await tx.invoiceSellerProfile.create({ data: { id: sellerId, organizationId: org,
          legalName: `${marker} TEST ONLY`, taxId: 'TEST-ONLY', registeredAddress: 'TEST ONLY', contactName: 'Synthetic fixture',
          contactEmail: 'owner@stallorder.test', contactPhone: '', defaultTaxType: 'MOCK_NOT_TAX_DETERMINED', verificationStatus: 'DRAFT' } });
        if (!connection) await tx.invoiceProviderConnection.create({ data: { id: connectionId, organizationId: org,
          provider: 'ECPAY', environment: 'MOCK', status: 'NOT_CONFIGURED', configurationJson: { legalInvoice: false, fixture: marker },
          createdByProfileId: owner.id, updatedByProfileId: owner.id } });
        if (!policy) await tx.invoicePolicyVersion.create({ data: { id: policyId, organizationId: org, version: 1,
          trigger: 'MANUAL', defaultTaxType: 'MOCK_NOT_TAX_DETERMINED', effectiveFrom: new Date(now()), createdByProfileId: owner.id } });
        await tx.order.createMany({ data: orders }); await tx.invoiceDocument.createMany({ data: docs });
      }, async () => {
        const [actualOrders, actualDocs, actualSeller, actualConnection, actualPolicy] = await Promise.all([
          db.order.findMany({ where: { ...where, id: { in: orders.map(row => row.id) }, isTest: true, source: 'PR366_MOCK_INVOICE_UI' } }),
          db.invoiceDocument.findMany({ where: { ...where, id: { in: docs.map(row => row.id) }, testDocument: true } }),
          db.invoiceSellerProfile.findFirst({ where: { id: sellerId, organizationId: org } }),
          db.invoiceProviderConnection.findFirst({ where: { id: connectionId, organizationId: org } }),
          db.invoicePolicyVersion.findFirst({ where: { id: policyId, organizationId: org } }),
        ]);
        if (!actualSeller || actualSeller.id !== sellerId || actualSeller.organizationId !== org || actualSeller.taxId !== 'TEST-ONLY'
          || !actualConnection || actualConnection.id !== connectionId || actualConnection.organizationId !== org
          || actualConnection.provider !== 'ECPAY' || actualConnection.environment !== 'MOCK'
          || !actualPolicy || actualPolicy.id !== policyId || actualPolicy.organizationId !== org
          || actualPolicy.defaultTaxType !== 'MOCK_NOT_TAX_DETERMINED' || actualPolicy.trigger !== 'MANUAL'
          || actualOrders.length !== 13 || actualDocs.length !== 13
          || orders.some(expected => !actualOrders.some(actual => actual.id === expected.id && actual.organizationId === org
            && actual.stallId === stall && actual.isTest === true && actual.origin === 'TEST'
            && actual.paymentStatus === 'UNPAID' && actual.status === 'COMPLETED' && actual.total === 100 && actual.subtotal === 100))
          || docs.some(row => !actualDocs.some(actual => actual.id === row.id && actual.organizationId === org && actual.stallId === stall
          && actual.orderId === row.orderId && actual.providerConnectionId === connectionId && actual.sellerProfileId === sellerId
          && actual.policyVersionId === policyId && actual.totalAmount === 100 && actual.salesAmount === 100 && actual.taxAmount === 0
          && actual.status === 'ISSUED' && actual.testDocument === true && actual.taxType === 'MOCK_NOT_TAX_DETERMINED'
          && actual.policySnapshotJson?.fixture === marker && actual.policySnapshotJson?.legalInvoice === false
          && actual.sellerSnapshotJson?.fixture === marker && actual.sellerSnapshotJson?.legalInvoice === false))) throw Error('FIXTURE_INVOICE_READBACK_FAILED');
        return actualDocs;
      }, { orderIds: orders.map(row => row.id), sellerId, connectionId, policyId });
    },
    async enableCircuitB() {
      const { owner } = await parents();
      const flag = await db.resilienceFeatureFlag.findUnique({ where: { code: 'DUAL_ORDER_INTAKE_ENABLED' } });
      if (!flag || flag.isEmergency) throw Error('FIXTURE_CIRCUIT_FLAG_DENIED');
      // Circuit B resolves a device-only context. This GLOBAL override exists solely in the verified data-less child.
      const scope = { flagId: flag.id, scopeType: 'GLOBAL', organizationId: null, stallId: null, deviceId: null };
      if ((await db.resilienceFeatureFlagOverride.findMany({ where: scope })).length) throw Error('FIXTURE_EXISTING_CIRCUIT_OVERRIDE_REQUIRES_REVIEW');
      const row = { id: randomUUID(), ...scope, enabled: true, rolloutPercentage: 100,
        expiresAt: new Date(receipt.expiresAt), reason: `${marker} synthetic Circuit B QA`,
        createdByProfileId: owner.id, updatedByProfileId: owner.id };
      const evidence = { ...identity, kind: 'CIRCUIT_B', before: [], after: row, status: 'PLANNED' };
      await save(evidence); guard(); await db.resilienceFeatureFlagOverride.create({ data: row });
      const actual = await db.resilienceFeatureFlagOverride.findUnique({ where: { id: row.id } });
      if (!actual || !actual.enabled || actual.flagId !== flag.id || actual.reason !== row.reason) throw Error('FIXTURE_READBACK_FAILED');
      evidence.after = actual; evidence.status = 'READBACK_VERIFIED'; await save(evidence); return evidence;
    },
    async restoreCircuitB(evidence) {
      guard();
      if (evidence.resourceKey !== receipt.resourceKey || evidence.childRef !== binding.childRef || evidence.kind !== 'CIRCUIT_B'
        || evidence.status !== 'READBACK_VERIFIED' || evidence.before?.length !== 0
        || evidence.after?.scopeType !== 'GLOBAL' || evidence.after?.reason !== `${marker} synthetic Circuit B QA`) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
      const flag = await db.resilienceFeatureFlag.findUnique({ where: { code: 'DUAL_ORDER_INTAKE_ENABLED' } });
      if (!flag || flag.id !== evidence.after.flagId) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
      const row = evidence.after;
      const removed = await db.resilienceFeatureFlagOverride.deleteMany({ where: { id: row.id, flagId: flag.id,
        scopeType: 'GLOBAL', organizationId: null, stallId: null, deviceId: null, enabled: true,
        reason: row.reason, updatedAt: new Date(row.updatedAt), expiresAt: new Date(row.expiresAt) } });
      if (removed.count !== 1) throw Error('FIXTURE_CIRCUIT_CONCURRENT_CHANGE');
      if (await db.resilienceFeatureFlagOverride.findUnique({ where: { id: row.id } })) throw Error('FIXTURE_RESTORE_READBACK_FAILED');
      await save({ ...identity, kind: 'CIRCUIT_B', status: 'RESTORED' });
    },
    async preparePosProduct() {
      await parents();
      if (await db.product.findFirst({ where: { organizationId: org, name: `${marker} POS` } })) throw Error('FIXTURE_ALREADY_PRESENT');
      const category = await db.productCategory.findFirst({ where: { organizationId: org } });
      if (!category) throw Error('FIXTURE_CATEGORY_REQUIRED');
      const product = { id: randomUUID(), organizationId: org, categoryId: category.id,
        name: `${marker} POS`, description: '隔離 POS 介面測試', defaultPrice: 100, sortOrder: 8999, isActive: true };
      const assignment = { id: randomUUID(), ...where, productId: product.id, isEnabled: true, isSoldOut: false };
      return batch('POS_PRODUCT', [product], async tx => {
        await tx.product.create({ data: product }); await tx.stallProduct.create({ data: assignment });
      }, async () => {
        const actual = await db.product.findMany({ where: { organizationId: org, id: product.id,
          noteGroupAssignments: { none: {} }, stallProducts: { some: { ...where, id: assignment.id, isEnabled: true } } } });
        if (actual.length !== 1 || actual[0].name !== product.name || actual[0].defaultPrice !== 100) throw Error('FIXTURE_READBACK_FAILED');
        return actual;
      }, { stallProductIds: [assignment.id] });
    },
    async prepareOrdering() {
      await parents();
      const before = await db.stallOrderingSettings.findFirst({ where, select: orderingSelect });
      if (!before) throw Error('FIXTURE_ORDERING_SETTINGS_REQUIRED');
      const desired = { deliveryModuleEnabled: true, staffDeliveryEnabled: true, printModuleEnabled: false, paymentModuleEnabled: true, kdsModuleEnabled: true };
      const evidence = { ...identity, kind: 'ORDERING_SETTINGS', before, after: desired, status: 'PLANNED' };
      await save(evidence); guard();
      const changed = await db.stallOrderingSettings.updateMany({ where: { ...where, updatedAt: before.updatedAt, ...orderingFields(before) }, data: desired });
      if (changed.count !== 1) throw Error('FIXTURE_ORDERING_CONCURRENT_CHANGE');
      const actual = await db.stallOrderingSettings.findFirst({ where, select: orderingSelect });
      if (!actual || serialize(orderingFields(actual)) !== serialize(desired)) throw Error('FIXTURE_READBACK_FAILED');
      evidence.after = actual; evidence.status = 'READBACK_VERIFIED'; await save(evidence); return evidence;
    },
    async restoreOrdering(evidence) {
      guard();
      if (evidence.resourceKey !== receipt.resourceKey || evidence.childRef !== binding.childRef
        || evidence.kind !== 'ORDERING_SETTINGS' || evidence.status !== 'READBACK_VERIFIED'
        || evidence.before?.stallId !== stall || evidence.before?.organizationId !== org
        || evidence.after?.stallId !== stall || evidence.after?.organizationId !== org) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
      const changed = await db.stallOrderingSettings.updateMany({ where: { ...where,
        updatedAt: new Date(evidence.after.updatedAt), ...orderingFields(evidence.after) }, data: orderingFields(evidence.before) });
      if (changed.count !== 1) throw Error('FIXTURE_ORDERING_CONCURRENT_CHANGE');
      const actual = await db.stallOrderingSettings.findFirst({ where, select: orderingSelect });
      if (!actual || serialize(orderingFields(actual)) !== serialize(orderingFields(evidence.before))) throw Error('FIXTURE_RESTORE_READBACK_FAILED');
      await save({ ...identity, kind: 'ORDERING_SETTINGS', status: 'RESTORED' });
    },
    async publicQr() {
      await parents();
      if (typeof savePrivate !== 'function') throw Error('FIXTURE_PRIVATE_RECEIPT_REQUIRED');
      const settings = await db.stallOrderingSettings.findFirst({ where, select: orderingSelect });
      if (!settings?.deliveryModuleEnabled) throw Error('FIXTURE_DELIVERY_NOT_ENABLED');
      const rows = ['DEFAULT', 'DELIVERY'].map(mode => ({ id: randomUUID(), ...where, token: randomUUID(),
        label: `${marker} ${mode}`, fulfillmentTypeContext: mode === 'DELIVERY' ? 'DELIVERY' : null,
        state: 'ACTIVE', expiresAt: new Date(receipt.expiresAt) }));
      const publicEvidence = { ...identity, kind: 'PUBLIC_QR', deliveryModuleEnabled: true, status: 'PLANNED',
        rows: rows.map((row, index) => ({ id: row.id, mode: index === 0 ? 'DEFAULT' : 'DELIVERY',
          tokenFingerprint: createHash('sha256').update(row.token).digest('hex') })) };
      const privateEvidence = { ...publicEvidence, qrs: rows.map((row, index) => ({ id: row.id,
        mode: index === 0 ? 'DEFAULT' : 'DELIVERY', qrToken: row.token })) };
      await save(publicEvidence); await savePrivate(privateEvidence); guard();
      await db.qrCode.createMany({ data: rows });
      const actual = await db.qrCode.findMany({ where: { ...where, id: { in: rows.map(row => row.id) } } });
      if (actual.length !== 2 || rows.some(row => !actual.some(found => found.id === row.id && found.token === row.token
        && found.state === 'ACTIVE' && found.fulfillmentTypeContext === row.fulfillmentTypeContext))) throw Error('FIXTURE_QR_READBACK_FAILED');
      publicEvidence.status = 'READBACK_VERIFIED'; privateEvidence.status = 'READBACK_VERIFIED';
      await save(publicEvidence); await savePrivate(privateEvidence); return privateEvidence;
    },
    async posDescriptor() {
      await parents();
      const candidates = await db.product.findMany({ where: { organizationId: org, name: `${marker} POS`,
        isActive: true, noteGroupAssignments: { none: {} } }, take: 2 });
      if (candidates.length !== 1) throw Error('FIXTURE_UNIQUE_POS_PRODUCT_REQUIRED');
      const catalog = candidates[0];
      const [product, settings, shift] = await Promise.all([
        db.stallProduct.findFirst({ where: { ...where, productId: catalog.id, isEnabled: true, isSoldOut: false }, include: { product: true } }),
        db.stallOrderingSettings.findFirst({ where, select: orderingSelect }),
        db.cashShift.findFirst({ where: { ...where, status: 'OPEN' }, select: { id: true } }),
      ]);
      if (!product || !settings || settings.printModuleEnabled || !settings.paymentModuleEnabled || !shift) throw Error('FIXTURE_POS_PREREQUISITES_REQUIRED');
      const evidence = { ...identity, kind: 'STAFF_POS', status: 'READBACK_VERIFIED',
        productId: product.productId, name: product.product.name, price: product.priceOverride ?? product.product.defaultPrice,
        cashShiftId: shift.id, isolatedSeed: true, ...orderingFields(settings) };
      await save(evidence); return evidence;
    },
    async catalogDescriptor() {
      await parents();
      const products = await db.product.findMany({ where: { organizationId: org, name: '香酥雞排', isActive: true,
        stallProducts: { some: { stallId: stall, organizationId: org, isEnabled: true } } }, take: 2 });
      if (products.length !== 1) throw Error('FIXTURE_UNIQUE_SEED_PRODUCT_REQUIRED');
      const evidence = { resourceKey: receipt.resourceKey, childRef: binding.childRef,
        deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree,
        organizationId: org, productId: products[0].id, originalName: products[0].name, isolatedSeed: true };
      await save(evidence); return evidence;
    },
    async enableSupplyModule() {
      const { owner } = await parents();
      const flag = await db.resilienceFeatureFlag.findUnique({ where: { code: 'MODULE_SUPPLY_LITE_ENABLED' } });
      if (!flag || flag.isEmergency) throw Error('FIXTURE_MODULE_FLAG_DENIED');
      const scope = { flagId: flag.id, scopeType: 'ORGANIZATION', organizationId: org };
      const before = await db.resilienceFeatureFlagOverride.findMany({ where: scope });
      if (before.length) {
        if (before.length !== 1 || !isSeedSupplyOverride(before[0], flag.id, owner.id, now())) throw Error('FIXTURE_EXISTING_MODULE_OVERRIDE_REQUIRES_REVIEW');
        const evidence = { ...identity, kind: 'SUPPLY_MODULE', mode: 'READ_ONLY_SEED_REUSE', before, after: before[0], status: 'READBACK_VERIFIED' };
        await save(JSON.parse(serialize(evidence))); return evidence;
      }
      const row = { id: randomUUID(), ...scope, enabled: true, rolloutPercentage: 100,
        expiresAt: new Date(receipt.expiresAt), reason: `${marker} synthetic UI QA`,
        createdByProfileId: owner.id, updatedByProfileId: owner.id };
      const evidence = { resourceKey: receipt.resourceKey, childRef: binding.childRef, kind: 'SUPPLY_MODULE', before: [], after: row, status: 'PLANNED' };
      await save(JSON.parse(serialize(evidence))); guard();
      await db.resilienceFeatureFlagOverride.create({ data: row });
      const actual = await db.resilienceFeatureFlagOverride.findUnique({ where: { id: row.id } });
      if (!actual || !actual.enabled || actual.reason !== row.reason) throw Error('FIXTURE_READBACK_FAILED');
      evidence.after = actual; evidence.status = 'READBACK_VERIFIED';
      await save(JSON.parse(serialize(evidence))); return evidence;
    },
    async restoreSupplyModule(evidence) {
      guard();
      if (evidence?.mode === 'READ_ONLY_SEED_REUSE') {
        const { owner } = await parents();
        const flag = await db.resilienceFeatureFlag.findUnique({ where: { code: 'MODULE_SUPPLY_LITE_ENABLED' } });
        if (!flag || flag.isEmergency || evidence.kind !== 'SUPPLY_MODULE' || evidence.status !== 'READBACK_VERIFIED'
          || ['resourceKey','childRef','deploymentId','sha','tree','organizationId','stallId'].some(key => evidence[key] !== identity[key])
          || evidence.before?.length !== 1 || serialize(evidence.before[0]) !== serialize(evidence.after)
          || !isSeedSupplyOverride(evidence.after, flag.id, owner.id, now())) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
        const actual = await db.resilienceFeatureFlagOverride.findMany({ where: { flagId: flag.id, scopeType: 'ORGANIZATION', organizationId: org } });
        if (actual.length !== 1 || serialize(actual[0]) !== serialize(evidence.after)) throw Error('FIXTURE_MODULE_CONCURRENT_CHANGE');
        await save({ ...identity, kind: 'SUPPLY_MODULE', mode: 'READ_ONLY_SEED_REUSE', status: 'UNCHANGED_VERIFIED' }); return;
      }
      if (evidence.resourceKey !== receipt.resourceKey || evidence.childRef !== binding.childRef
        || evidence.kind !== 'SUPPLY_MODULE' || evidence.status !== 'READBACK_VERIFIED'
        || evidence.before?.length !== 0 || evidence.after?.organizationId !== org
        || evidence.after?.scopeType !== 'ORGANIZATION' || evidence.after?.reason !== `${marker} synthetic UI QA`) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
      const row = evidence.after;
      const deleted = await db.resilienceFeatureFlagOverride.deleteMany({ where: { id: row.id, flagId: row.flagId,
        organizationId: org, scopeType: 'ORGANIZATION', enabled: true, reason: row.reason,
        updatedAt: new Date(row.updatedAt), expiresAt: new Date(row.expiresAt) } });
      if (deleted.count !== 1) throw Error('FIXTURE_MODULE_CONCURRENT_CHANGE');
      if (await db.resilienceFeatureFlagOverride.findUnique({ where: { id: row.id } })) throw Error('FIXTURE_RESTORE_READBACK_FAILED');
      await save({ resourceKey: receipt.resourceKey, childRef: binding.childRef, kind: 'SUPPLY_MODULE', status: 'RESTORED' });
    },
    async setHours(mode) {
      await parents();
      const before = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      if (before.length !== 7 || before.some((row, index) => row.dayOfWeek !== index)) throw Error('FIXTURE_HOURS_SNAPSHOT_DENIED');
      const after = buildCalendarHours(before, mode, new Date(now()));
      const evidence = { ...identity, kind: 'HOURS', mode, before, after, status: 'PLANNED' };
      await save(JSON.parse(serialize(evidence)));
      guard();
      await db.$transaction(async tx => {
        for (const row of before) {
          const changed = await tx.stallBusinessHour.updateMany({ where: { ...where, id: row.id, updatedAt: row.updatedAt, ...hoursFields(row) }, data: hoursFields(after[row.dayOfWeek]) });
          if (changed.count !== 1) throw Error('FIXTURE_HOURS_CONCURRENT_CHANGE');
        }
      });
      const readback = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      if (serialize(readback.map(hoursFields)) !== serialize(after.map(hoursFields))) throw Error('FIXTURE_READBACK_FAILED');
      evidence.after = readback; evidence.status = 'READBACK_VERIFIED';
      await save(JSON.parse(serialize(evidence))); return evidence;
    },
    async restoreHours(evidence) {
      guard();
      if (evidence.resourceKey !== receipt.resourceKey || evidence.childRef !== binding.childRef || evidence.kind !== 'HOURS'
        || evidence.status !== 'READBACK_VERIFIED' || evidence.before?.length !== 7 || evidence.after?.length !== 7) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
      await db.$transaction(async tx => {
        for (const row of evidence.after) {
          const original = evidence.before.find(item => item.id === row.id && item.dayOfWeek === row.dayOfWeek);
          if (!original) throw Error('FIXTURE_RESTORE_RECEIPT_DENIED');
          const restored = await tx.stallBusinessHour.updateMany({ where: { ...where, id: row.id, updatedAt: new Date(row.updatedAt), ...hoursFields(row) }, data: hoursFields(original) });
          if (restored.count !== 1) throw Error('FIXTURE_HOURS_CONCURRENT_CHANGE');
        }
      });
      const actual = await db.stallBusinessHour.findMany({ where, orderBy: { dayOfWeek: 'asc' } });
      if (serialize(actual.map(hoursFields)) !== serialize(evidence.before.map(hoursFields))) throw Error('FIXTURE_RESTORE_READBACK_FAILED');
      await save({ resourceKey: receipt.resourceKey, childRef: binding.childRef, kind: 'HOURS', status: 'RESTORED' });
    },
    async denseSchedules() {
      await parents();
      const location = await db.stallLocation.findFirst({ where: { ...where, isActive: true } });
      if (!location) throw Error('FIXTURE_LOCATION_REQUIRED');
      const rows = Array.from({ length: 13 }, (_, index) => ({ id: randomUUID(), ...where, locationId: location.id,
        startsAt: new Date(now() + (index + 30) * 86400000), endsAt: new Date(now() + (index + 30) * 86400000 + 3600000),
        specialNotice: `${marker} schedule ${index + 1}`, autoOpenEnabled: false, autoCloseEnabled: false }));
      return batch('DENSE_SCHEDULE', rows, tx => tx.stallSchedule.createMany({ data: rows }),
        () => db.stallSchedule.findMany({ where: { ...where, id: { in: rows.map(row => row.id) } } }));
    },
    async denseWorkforce() {
      const { owner } = await parents();
      const member = await db.stallMembership.findFirst({ where: { ...where, isActive: true, role: 'STAFF' }, include: { profile: true } });
      if (!member) throw Error('FIXTURE_STAFF_REQUIRED');
      const first = new Date(now()); first.setUTCDate(1); first.setUTCHours(0, 0, 0, 0);
      const rows = Array.from({ length: 13 }, (_, index) => ({ id: randomUUID(), ...where, profileId: member.profileId,
        workDate: new Date(first.getTime() + index * 86400000), shiftStartAt: null, shiftEndAt: null,
        dayType: 'WORKDAY', status: 'PUBLISHED', note: `${marker} workforce ${index + 1}`, createdByProfileId: owner.id }));
      return batch('DENSE_WORKFORCE', rows, tx => tx.workforceSchedule.createMany({ data: rows }),
        () => db.workforceSchedule.findMany({ where: { ...where, id: { in: rows.map(row => row.id) } } }));
    },
    async denseSupply() {
      const { owner } = await parents();
      const category = await db.productCategory.findFirst({ where: { organizationId: org } });
      if (!category) throw Error('FIXTURE_CATEGORY_REQUIRED');
      const products = Array.from({ length: 13 }, (_, i) => ({ id: randomUUID(), organizationId: org, categoryId: category.id,
        name: `${marker} recipe ${i + 1}`, description: '隔離介面合成資料', defaultPrice: 100, isActive: true, sortOrder: 9000 + i }));
      const ingredients = products.map((product, i) => ({ id: randomUUID(), organizationId: org, code: `pr366-${receipt.resourceKey}-${i}`,
        name: product.name, baseUom: 'g', createdByProfileId: owner.id }));
      const recipes = products.map((product, i) => ({ id: randomUUID(), organizationId: org, productId: product.id,
        ingredientId: ingredients[i].id, quantityMicros: 1000000n, createdByProfileId: owner.id }));
      const evidence = await batch('DENSE_SUPPLY', products, async tx => {
        await tx.product.createMany({ data: products }); await tx.supplyIngredient.createMany({ data: ingredients });
        await tx.supplyRecipeComponent.createMany({ data: recipes });
      }, async () => {
        const [actualProducts, actualIngredients, actualRecipes] = await Promise.all([
          db.product.findMany({ where: { organizationId: org, id: { in: products.map(row => row.id) } } }),
          db.supplyIngredient.findMany({ where: { organizationId: org, id: { in: ingredients.map(row => row.id) } } }),
          db.supplyRecipeComponent.findMany({ where: { organizationId: org, id: { in: recipes.map(row => row.id) } } }),
        ]);
        if (actualIngredients.length !== 13 || actualRecipes.length !== 13
          || ingredients.some(expected => !actualIngredients.some(actual => actual.id === expected.id
            && actual.organizationId === org && actual.code === expected.code && actual.name === expected.name))
          || recipes.some(expected => !actualRecipes.some(actual => actual.id === expected.id
            && actual.organizationId === org && actual.productId === expected.productId
            && actual.ingredientId === expected.ingredientId && actual.quantityMicros === expected.quantityMicros))) {
          throw Error('FIXTURE_SUPPLY_RELATION_READBACK_FAILED');
        }
        return actualProducts;
      },
      { ingredientIds: ingredients.map(row => row.id), recipeIds: recipes.map(row => row.id) });
      evidence.ingredientIds = ingredients.map(row => row.id); evidence.recipeIds = recipes.map(row => row.id);
      await save(JSON.parse(serialize(evidence))); return evidence;
    },
    async denseInvoices(orderReceipt) {
      await parents();
      if (orderReceipt?.resourceKey !== receipt.resourceKey || orderReceipt?.childRef !== binding.childRef
        || orderReceipt?.status !== 'READBACK_VERIFIED' || orderReceipt?.orderIds?.length !== 13
        || new Set(orderReceipt.orderIds).size !== 13) throw Error('FIXTURE_TEST_ORDER_RECEIPT_REQUIRED');
      const orders = await db.order.findMany({ where: { ...where, isTest: true, id: { in: orderReceipt.orderIds } } });
      if (orders.length !== 13) throw Error('FIXTURE_TEST_ORDERS_DENIED');
      const template = await db.invoiceDocument.findFirst({ where: { ...where, testDocument: true,
        providerConnection: { environment: 'MOCK' } }, include: { providerConnection: true } });
      if (!template) throw Error('FIXTURE_MOCK_INVOICE_TEMPLATE_REQUIRED');
      const rows = orders.map((order, i) => ({ id: randomUUID(), ...where, orderId: order.id,
        providerConnectionId: template.providerConnectionId, sellerProfileId: template.sellerProfileId,
        policyVersionId: template.policyVersionId, salesAmount: 100, taxAmount: 0, totalAmount: 100,
        taxType: template.taxType, roundingPolicy: template.roundingPolicy, buyerType: template.buyerType,
        policySnapshotJson: template.policySnapshotJson, sellerSnapshotJson: template.sellerSnapshotJson,
        buyerSnapshotJson: {}, testDocument: true, status: 'ISSUED', issuedAt: new Date(now()),
        externalInvoiceNumber: `PR366-${receipt.resourceKey}-${i}`, documentType: 'ORIGINAL' }));
      return batch('DENSE_MOCK_INVOICE', rows, tx => tx.invoiceDocument.createMany({ data: rows }),
        () => db.invoiceDocument.findMany({ where: { ...where, id: { in: rows.map(row => row.id) } } }));
    },
    disconnect: () => db.$disconnect(),
  };
}
