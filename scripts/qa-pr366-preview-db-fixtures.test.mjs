import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assertDatabaseTarget, buildCalendarHours, createDatabaseFixtures, runDatabaseFixture, fixtureFailureCode } from './qa-pr366-preview-db-fixtures.mjs';
import { isWithinBusinessHours } from '../src/lib/business-hours';
const now = Date.parse('2026-10-03T10:00:00Z');
function syntheticDatabaseUrl(host, username = 'postgres', port = '5432', tls = true) {
  const url = new URL(`postgresql://${host}/postgres`);
  url.username = username; url.password = 'synthetic-test-only'; url.port = port;
  if (tls) url.searchParams.set('sslmode', 'require');
  return url.href;
}
function fixture() {
  const receipt = { resourceKey: 'manual-123', parent: 'eyuctbnlvnbnivwasvqr', project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP', team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', gitBranch: 'codex/integrated-production-20261002', expiresAt: new Date(now + 60_000).toISOString(), status: 'CAPTURED', branches: [{ id: 'child123' }], deployments: [{ id: 'dpl123', target: 'preview' }] };
  const binding = { origin: 'https://dedicated-test.vercel.app', resourceKey: receipt.resourceKey, providerReadback: 'VERIFIED', sha: 'a'.repeat(40), tree: 'b'.repeat(40), childRef: 'child123', deploymentId: 'dpl123', productionAlias: false, dataLess: true };
  binding.readback = { verifiedAt: new Date(now).toISOString(), childScope: { provider: 'supabase-cli', operation: 'branches list', parentProjectRef: receipt.parent }, child: { project_ref: binding.childRef, name: receipt.resourceKey, parent_project_ref: receipt.parent, with_data: false, git_branch: receipt.gitBranch }, deployment: { id: binding.deploymentId, projectId: receipt.project, teamId: receipt.team, target: 'preview', origin: binding.origin, meta: { stallorderPreviewResource: receipt.resourceKey, githubCommitRef: receipt.gitBranch, githubCommitSha: binding.sha } }, source: { sha: binding.sha, tree: binding.tree } };
  return { receipt, binding };
}

function dbFixture() {
  const target = fixture();
  target.binding.readback.database = { projectRef: 'child123', host: 'db.child123.supabase.co', database: 'postgres', ownerResourceKey: 'manual-123' };
  return { ...target, databaseUrl: syntheticDatabaseUrl('db.child123.supabase.co') };
}

function membershipDatabase(existing = []) {
  let member;
  const create = vi.fn(async ({ data }) => { member = { ...data, updatedAt: new Date(now) }; return member; });
  const db = {
    profile: { findFirst: async query => ({ id: query.where.email.startsWith('owner') ? 'owner-id' : 'staff-id', email: query.where.email, isActive: true, platformRole: null }) },
    stall: { findFirst: async () => ({ id: 'stall' }) },
    billingNotification: { findFirst: async () => ({ id: 'notice-id', title: 'PR366 manual-123 通知測試' }) },
    organizationMembership: { findMany: async () => existing, create, findFirst: async () => member }, $disconnect: vi.fn(),
  };
  return { db, create };
}
test('membership creates only the exact non-primary staff fixture and journals before write', async () => {
  const { db, create } = membershipDatabase(); const save = vi.fn();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => db });
  const result = await tool.inboxMembership();
  expect(save.mock.calls[0][0]).toMatchObject({ status: 'PLANNED', role: 'FINANCE_VIEWER', isPrimaryOwner: false });
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: '11111111-1111-4111-8111-111111111111',
    profileId: 'staff-id', role: 'FINANCE_VIEWER', isPrimaryOwner: false, isActive: true }) });
  expect(result.status).toBe('READBACK_VERIFIED');
});
test('existing staff organization membership blocks fixture creation', async () => {
  const { db, create } = membershipDatabase([{ id: 'existing-owner' }]);
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  await expect(tool.inboxMembership()).rejects.toThrow('EXISTING_ORG_MEMBERSHIP'); expect(create).not.toHaveBeenCalled();
});
test('membership revoked DB readback requires the original owned descriptor and live-session API evidence', async () => {
  const options = dbFixture(); const { db } = membershipDatabase(); const save = vi.fn();
  const tool = await createDatabaseFixtures({ ...options, now: () => now, save, clientFactory: async () => db });
  const descriptor = await tool.inboxMembership(); options.binding.fixtures = { membership: descriptor };
  db.organizationMembership.findFirst = vi.fn(async () => ({ ...descriptor, isActive: false, profile: { email: 'staff@stallorder.test', isActive: true } }));
  const evidence = { ...descriptor, kind: 'INBOX_MEMBERSHIP_REVOKED', status: 'API_REVOKE_VERIFIED',
    sessionStillValid: true, ownerStillAuthorized: true, privateStateCleared: true };
  expect((await tool.inboxMembershipReadback(evidence)).status).toBe('DB_REVOKE_VERIFIED');
  expect(db.organizationMembership.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: descriptor.membershipId,
    profileId: descriptor.profileId, role: 'FINANCE_VIEWER', isActive: false, isPrimaryOwner: false }), include: { profile: true } });
  for (const patch of [{ sessionStillValid: false }, { privateStateCleared: false }, { membershipId: 'another-row' }])
    await expect(tool.inboxMembershipReadback({ ...evidence, ...patch })).rejects.toThrow('MEMBERSHIP_EVIDENCE_DENIED');
});

function midnightDatabase(wrongResult = false) {
  const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ id: `hour-${dayOfWeek}`, dayOfWeek, opensAt: '17:00', closesAt: '23:00', lastOrderAt: null, isClosed: false }));
  let active = structuredClone(hours); let special = false; let rollbackCount = 0;
  const queries = [];
  const db = {
    profile: { findFirst: async () => ({ id: 'owner' }) }, stall: { findFirst: async () => ({ id: 'stall' }) },
    stallBusinessHour: { findMany: async () => structuredClone(active), updateMany: async ({ where, data }) => {
      active = active.map(row => where.dayOfWeek === undefined || row.dayOfWeek === where.dayOfWeek ? { ...row, ...data } : row);
      return { count: where.dayOfWeek === undefined ? 7 : 1 };
    } },
    stallSpecialClosure: { count: async () => special ? 1 : 0, create: async () => { special = true; } },
    qrCode: { findMany: async () => [{ token: 'secret-default', fulfillmentTypeContext: null }, { token: 'secret-delivery', fulfillmentTypeContext: 'DELIVERY' }] },
    $executeRaw: vi.fn(async () => 0), $queryRaw: async (strings, ...values) => {
      if (!strings.join('').includes('public_order_calendar_code')) return [];
      queries.push(values); const instant = new Date(values[1]).toISOString();
      let actual = null;
      if (special) actual = 'STALL_SPECIAL_CLOSURE';
      else if (instant === '2026-10-05T13:59:59.000Z' || instant === '2026-10-05T18:00:00.000Z') actual = 'STALL_CLOSED';
      else if (active[1].lastOrderAt && instant === '2026-10-05T17:30:00.000Z') actual = 'QR_LAST_ORDER_PASSED';
      return [{ actual: wrongResult ? 'UNEXPECTED' : actual }];
    },
    $transaction: async action => { try { return await action(db); } catch (error) {
      active = structuredClone(hours); special = false; rollbackCount++; throw error;
    } }, $disconnect: vi.fn(),
  };
  return { db, queries, rollbackCount: () => rollbackCount };
}
test('midnight proof always rolls back and independently reads unchanged hours/absence before PASS', async () => {
  const f = midnightDatabase(); const save = vi.fn();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => f.db });
  const result = await tool.midnightRollback();
  expect(f.rollbackCount()).toBe(1); expect(f.queries).toHaveLength(18);
  expect(new Set(f.queries.map(row => row[0]))).toEqual(new Set(['secret-default','secret-delivery']));
  expect(result).toMatchObject({ status: 'PASS', rolledBack: true, originalHoursUnchanged: true, closureAbsent: true });
  expect(JSON.stringify(result)).not.toContain('secret-default');
});
test('any incorrect calendar result cannot PASS even when rollback succeeds', async () => {
  const f = midnightDatabase(true); const save = vi.fn();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => f.db });
  await expect(tool.midnightRollback()).rejects.toThrow('MIDNIGHT_PROOF_FAILED');
  expect(f.rollbackCount()).toBe(1); expect(save.mock.calls.at(-1)[0].status).toBe('FAIL');
});
test('unexpected DB transaction error is not mistaken for intentional rollback success', async () => {
  const f = midnightDatabase(); f.db.$queryRaw = async () => { throw Error('DB_UNAVAILABLE'); };
  const save = vi.fn(); const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => f.db });
  await expect(tool.midnightRollback()).rejects.toThrow('DB_UNAVAILABLE'); expect(save).not.toHaveBeenCalled();
});
test('midnight refuses ambiguous QR candidates and rolls back without a PASS receipt', async () => {
  const f = midnightDatabase(); f.db.qrCode.findMany = async () => [{ token: 'secret-default', fulfillmentTypeContext: null }];
  const save = vi.fn(); const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => f.db });
  await expect(tool.midnightRollback()).rejects.toThrow('EXACT_QRS_REQUIRED');
  expect(f.rollbackCount()).toBe(1); expect(f.queries).toHaveLength(0); expect(save).not.toHaveBeenCalled();
});

test.each([
  syntheticDatabaseUrl('db.eyuctbnlvnbnivwasvqr.supabase.co'),
  syntheticDatabaseUrl('localhost'),
  syntheticDatabaseUrl('pooler.supabase.com', 'postgres.child123'),
  syntheticDatabaseUrl('db.child123.supabase.co', 'postgres', '5432', false),
])('rejects any URL outside direct verified encrypted child', url => {
  const { receipt, binding } = dbFixture();
  expect(() => assertDatabaseTarget(receipt, binding, url, now)).toThrow('DATABASE_TARGET_DENIED');
});

test('rejects missing DB provider ownership before client construction', async () => {
  const options = dbFixture(); delete options.binding.readback.database;
  const factory = vi.fn();
  await expect(createDatabaseFixtures({ ...options, now: () => now, save: vi.fn(), clientFactory: factory })).rejects.toThrow('DATABASE_TARGET_DENIED');
  expect(factory).not.toHaveBeenCalled();
});

test('accepts provider-issued pooler only with exact child user and identity fingerprint', () => {
  const { receipt, binding } = dbFixture();
  const host = 'aws-0-test.pooler.supabase.com';
  binding.readback.database = { projectRef: 'child123', host, database: 'postgres', ownerResourceKey: 'manual-123',
    username: 'postgres.child123', port: 6543, identityFingerprint: createHash('sha256').update(`${host}:6543/postgres|postgres.child123`).digest('hex') };
  const url = syntheticDatabaseUrl(host, 'postgres.child123', '6543');
  expect(assertDatabaseTarget(receipt, binding, url, now)).toBe(url);
  binding.readback.database.identityFingerprint = 'invalid';
  expect(() => assertDatabaseTarget(receipt, binding, url, now)).toThrow('DATABASE_TARGET_DENIED');
});

function mockDatabase(conflict = false) {
  let rows = Array.from({ length: 7 }, (_, dayOfWeek) => ({ id: `hour-${dayOfWeek}`, dayOfWeek, opensAt: '17:00', closesAt: '23:00', lastOrderAt: null, isClosed: false, updatedAt: new Date(now) }));
  const updates = [];
  const db = {
    profile: { findFirst: async () => ({ id: 'owner' }) }, stall: { findFirst: async () => ({ id: 'stall' }) },
    stallBusinessHour: { findMany: async () => structuredClone(rows), updateMany: async query => {
      updates.push(query);
      if (conflict) return { count: 0 };
      rows = rows.map(row => row.id === query.where.id ? { ...row, ...query.data, updatedAt: new Date(now + 1) } : row);
      return { count: 1 };
    } },
    $transaction: async action => action(db), $disconnect: vi.fn(),
  };
  return { db, updates };
}

test('hours snapshot/readback and conditional restore include exact rows and version', async () => {
  const { db, updates } = mockDatabase(); const save = vi.fn();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => db });
  const evidence = await tool.setHours('CLOSED');
  expect(evidence.after.every(row => row.isClosed)).toBe(true);
  expect(save.mock.calls[0][0].status).toBe('PLANNED');
  await tool.restoreHours(JSON.parse(JSON.stringify(evidence)));
  expect(updates).toHaveLength(14);
  expect(updates.every(query => query.where.id && query.where.updatedAt && query.where.organizationId && query.where.stallId)).toBe(true);
  expect(save.mock.calls.at(-1)[0].status).toBe('RESTORED');
  await tool.disconnect(); expect(db.$disconnect).toHaveBeenCalledOnce();
});

test('concurrent hours changes reject instead of overwriting', async () => {
  const { db } = mockDatabase(true);
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  await expect(tool.setHours('OPEN')).rejects.toThrow('CONCURRENT_CHANGE');
});

test('invoice setup requires 13 separately receipted actual test orders', async () => {
  const { db } = mockDatabase();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  await expect(tool.denseInvoices({ orderIds: Array(13).fill('same') })).rejects.toThrow('TEST_ORDER_RECEIPT_REQUIRED');
});

test.each(['denseSchedules', 'denseWorkforce', 'denseSupply'])('bounds %s to 13 dedicated rows and persists planned IDs first', async action => {
  const { db } = mockDatabase(); const saves = [];
  const stores = new Map();
  for (const model of ['stallSchedule', 'workforceSchedule', 'product', 'supplyIngredient', 'supplyRecipeComponent']) {
    stores.set(model, []);
    db[model] = { createMany: async ({ data }) => {
      expect(saves[0].status).toBe('PLANNED');
      stores.set(model, structuredClone(data)); return { count: data.length };
    }, findMany: async () => stores.get(model) };
  }
  db.stallLocation = { findFirst: async () => ({ id: 'location' }) };
  db.stallMembership = { findFirst: async () => ({ profileId: 'staff' }) };
  db.productCategory = { findFirst: async () => ({ id: 'category' }) };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => saves.push(structuredClone(evidence)), clientFactory: async () => db });
  const evidence = await tool[action]();
  expect(evidence.rows).toHaveLength(13);
  expect(new Set(evidence.rows.map(row => row.id)).size).toBe(13);
  expect(saves.at(-1).status).toBe('READBACK_VERIFIED');
  if (action === 'denseSchedules') expect(stores.get('stallSchedule').every(row => !row.autoOpenEnabled && !row.autoCloseEnabled)).toBe(true);
  if (action === 'denseSupply') {
    expect(saves[0].relatedIds.ingredientIds).toHaveLength(13);
    expect(saves[0].relatedIds.recipeIds).toHaveLength(13);
  }
});

test('CLI invalid operation fails before reading credentials or constructing a client', async () => {
  await expect(runDatabaseFixture({}, {}, '.', 'prepare-everything')).rejects.toThrow('FIXTURE_OPERATION_DENIED');
});

test('missing recipe readback never persists verified supply receipt', async () => {
  const { db } = mockDatabase(); const saves = []; const stores = new Map();
  for (const model of ['product', 'supplyIngredient', 'supplyRecipeComponent']) {
    stores.set(model, []);
    db[model] = { createMany: async ({ data }) => { stores.set(model, data); return { count: data.length }; },
      findMany: async () => model === 'supplyRecipeComponent' ? stores.get(model).slice(1) : stores.get(model) };
  }
  db.productCategory = { findFirst: async () => ({ id: 'category' }) };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => saves.push(structuredClone(evidence)), clientFactory: async () => db });
  await expect(tool.denseSupply()).rejects.toThrow('SUPPLY_RELATION_READBACK_FAILED');
  expect(saves).toHaveLength(1);
  expect(saves[0].status).toBe('PLANNED');
  expect(saves[0].relatedIds.recipeIds).toHaveLength(13);
});

test('supply override is exact organization scoped, expires with child, and restores conditionally', async () => {
  const { db } = mockDatabase(); let override = null;
  db.resilienceFeatureFlag = { findUnique: async () => ({ id: 'supply-flag', isEmergency: false }) };
  const remove = vi.fn(async ({ where }) => {
    expect(where.id).toBe(override.id); expect(where.updatedAt).toEqual(override.updatedAt);
    override = null; return { count: 1 };
  });
  db.resilienceFeatureFlagOverride = { findMany: async () => [],
    create: async ({ data }) => { override = { ...data, updatedAt: new Date(now) }; },
    findUnique: async () => override, deleteMany: remove };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  const evidence = await tool.enableSupplyModule();
  expect(evidence.after.scopeType).toBe('ORGANIZATION');
  expect(evidence.after.expiresAt.toISOString()).toBe(dbFixture().receipt.expiresAt);
  await tool.restoreSupplyModule(JSON.parse(JSON.stringify(evidence)));
  expect(remove).toHaveBeenCalledOnce();
});

test('existing module override is left untouched', async () => {
  const { db } = mockDatabase(); const write = vi.fn();
  db.resilienceFeatureFlag = { findUnique: async () => ({ id: 'supply-flag', isEmergency: false }) };
  db.resilienceFeatureFlagOverride = { findMany: async () => [{ id: 'someone-elses' }], create: write };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  await expect(tool.enableSupplyModule()).rejects.toThrow('EXISTING_MODULE_OVERRIDE');
  expect(write).not.toHaveBeenCalled();
});

function seedSupplyDatabase(patch = {}) {
  const { db } = mockDatabase(); const write = vi.fn();
  db.profile.findFirst = async () => ({ id: '55555555-5555-4555-8555-555555555551' });
  const row = { id: 'seed-override', flagId: 'supply-flag', scopeType: 'ORGANIZATION', organizationId: '11111111-1111-4111-8111-111111111111',
    stallId: null, deviceId: null, rolloutPercentage: null, enabled: true, expiresAt: null, reason: 'Local Supply Lite verification only',
    createdByProfileId: '55555555-5555-4555-8555-555555555551', updatedByProfileId: '55555555-5555-4555-8555-555555555551',
    createdAt: new Date(now), updatedAt: new Date(now), ...patch };
  db.resilienceFeatureFlag = { findUnique: async () => ({ id: 'supply-flag', isEmergency: false }) };
  db.resilienceFeatureFlagOverride = { findMany: async () => [row], create: write, deleteMany: write, updateMany: write };
  return { db, row, write };
}
test('known enabled seed Supply override is reused read-only and remains byte-equivalent on restore', async () => {
  const { db, write } = seedSupplyDatabase(); const save = vi.fn();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => db });
  const evidence = await tool.enableSupplyModule();
  expect(evidence).toMatchObject({ mode: 'READ_ONLY_SEED_REUSE', status: 'READBACK_VERIFIED' });
  await tool.restoreSupplyModule(JSON.parse(JSON.stringify(evidence)));
  expect(write).not.toHaveBeenCalled(); expect(save.mock.calls.at(-1)[0].status).toBe('UNCHANGED_VERIFIED');
});
test.each([{ enabled: false }, { reason: 'someone else' }, { createdByProfileId: 'other' }, { updatedByProfileId: 'other' },
  { expiresAt: new Date(now) }, { rolloutPercentage: 50 }, { deviceId: 'other-device' }, { organizationId: 'other-org' }])('rejects unrecognized/expired Supply override %j', async patch => {
  const { db, write } = seedSupplyDatabase(patch);
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  await expect(tool.enableSupplyModule()).rejects.toThrow('EXISTING_MODULE_OVERRIDE'); expect(write).not.toHaveBeenCalled();
});
test('seed reuse restore refuses any changed field instead of deleting or overwriting it', async () => {
  const { db, row, write } = seedSupplyDatabase();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  const evidence = JSON.parse(JSON.stringify(await tool.enableSupplyModule())); row.updatedAt = new Date(now + 1);
  await expect(tool.restoreSupplyModule(evidence)).rejects.toThrow('CONCURRENT_CHANGE'); expect(write).not.toHaveBeenCalled();
});
test('fixture diagnostics expose only exact safe codes, never raw DB messages or URLs', () => {
  const diagnosticUrl = syntheticDatabaseUrl('db.synthetic-test.invalid');
  expect(fixtureFailureCode({ code: 'P2002', message: diagnosticUrl })).toBe('P2002');
  expect(fixtureFailureCode(Error('FIXTURE_EXISTING_MODULE_OVERRIDE_REQUIRES_REVIEW'))).toBe('FIXTURE_EXISTING_MODULE_OVERRIDE_REQUIRES_REVIEW');
  for (const error of [Error(diagnosticUrl), { code: 'P2002 secret' }, Error('FIXTURE_DENIED\nsecret')])
    expect(fixtureFailureCode(error)).toBe('UNCLASSIFIED');
});

test('catalog descriptor reads unique active assigned seed product without writes', async () => {
  const { db } = mockDatabase(); const query = vi.fn(async () => [{ id: 'seed-product', name: '香酥雞排' }]);
  db.product = { findMany: query }; const save = vi.fn();
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => db });
  const descriptor = await tool.catalogDescriptor();
  expect(descriptor).toMatchObject({ productId: 'seed-product', isolatedSeed: true, childRef: 'child123' });
  expect(query.mock.calls[0][0].where.stallProducts.some.isEnabled).toBe(true);
  expect(save).toHaveBeenCalledOnce();
});

test('dedicated public QR tokens remain exclusively in private handoff receipts', async () => {
  const { db } = mockDatabase(); const publicSaves = []; const privateSaves = []; let rows;
  db.stallOrderingSettings = { findFirst: async () => ({ deliveryModuleEnabled: true }) };
  db.qrCode = { createMany: async ({ data }) => { rows = data; }, findMany: async () => rows };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => publicSaves.push(structuredClone(evidence)),
    savePrivate: async evidence => privateSaves.push(structuredClone(evidence)), clientFactory: async () => db });
  const descriptor = await tool.publicQr();
  expect(descriptor.status).toBe('READBACK_VERIFIED');
  expect(descriptor.qrs.map(row => row.mode)).toEqual(['DEFAULT', 'DELIVERY']);
  expect(privateSaves).toHaveLength(2);
  for (const qr of descriptor.qrs) expect(JSON.stringify(publicSaves)).not.toContain(qr.qrToken);
  expect(rows.every(row => row.expiresAt.toISOString() === dbFixture().receipt.expiresAt)).toBe(true);
});

test('public QR creation refuses absent private receipt destination before writes', async () => {
  const { db } = mockDatabase(); const write = vi.fn(); db.qrCode = { createMany: write };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  await expect(tool.publicQr()).rejects.toThrow('PRIVATE_RECEIPT_REQUIRED'); expect(write).not.toHaveBeenCalled();
});

test('ordering setup retains exact safe-field snapshot and restores with concurrency predicate', async () => {
  const { db } = mockDatabase(); const publicSaves = [];
  let row = { organizationId: '11111111-1111-4111-8111-111111111111', stallId: '22222222-2222-4222-8222-222222222222',
    updatedAt: new Date(now), deliveryModuleEnabled: false, staffDeliveryEnabled: false,
    printModuleEnabled: true, paymentModuleEnabled: false, kdsModuleEnabled: false };
  const initial = structuredClone(row); const writes = [];
  db.stallOrderingSettings = { findFirst: async () => structuredClone(row), updateMany: async query => {
    writes.push(query); row = { ...row, ...query.data, updatedAt: new Date(now + writes.length) }; return { count: 1 };
  } };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => publicSaves.push(structuredClone(evidence)), clientFactory: async () => db });
  const receipt = await tool.prepareOrdering(); expect(receipt.after.printModuleEnabled).toBe(false);
  await tool.restoreOrdering(JSON.parse(JSON.stringify(receipt)));
  expect(row).toMatchObject({ ...initial, updatedAt: new Date(now + 2) });
  expect(writes.every(query => query.where.updatedAt && query.where.organizationId && query.where.stallId)).toBe(true);
  expect(publicSaves.at(-1).status).toBe('RESTORED');
});

test('POS readback refuses printing-enabled settings or missing cash shift', async () => {
  const { db } = mockDatabase(); db.product = { findMany: async () => [{ id: 'product', name: '香酥雞排' }] };
  db.stallProduct = { findFirst: async () => ({ productId: 'product', product: { name: '香酥雞排', defaultPrice: 100 } }) };
  db.stallOrderingSettings = { findFirst: async () => ({ printModuleEnabled: true, paymentModuleEnabled: true }) };
  db.cashShift = { findFirst: async () => null };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  await expect(tool.posDescriptor()).rejects.toThrow('POS_PREREQUISITES_REQUIRED');
});

test('Circuit B override remains child-only, expires and restores only the exact created version', async () => {
  const { db } = mockDatabase(); let row = null;
  db.resilienceFeatureFlag = { findUnique: async query => {
    expect(query.where.code).toBe('DUAL_ORDER_INTAKE_ENABLED'); return { id: 'circuit-flag', isEmergency: false };
  } };
  db.resilienceFeatureFlagOverride = { findMany: async () => [], create: async ({ data }) => { row = { ...data, updatedAt: new Date(now) }; },
    findUnique: async () => row, deleteMany: async ({ where }) => {
      expect(where.scopeType).toBe('GLOBAL'); expect(where.organizationId).toBeNull();
      expect(where.updatedAt).toEqual(row.updatedAt); row = null; return { count: 1 };
    } };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save: vi.fn(), clientFactory: async () => db });
  const evidence = await tool.enableCircuitB();
  expect(evidence.childRef).toBe('child123'); expect(evidence.after.expiresAt.toISOString()).toBe(dbFixture().receipt.expiresAt);
  await tool.restoreCircuitB(JSON.parse(JSON.stringify(evidence))); expect(row).toBeNull();
});

test('dedicated POS product creates one assigned product without note assignments', async () => {
  const { db } = mockDatabase(); let created; const saves = [];
  db.productCategory = { findFirst: async () => ({ id: 'category' }) };
  db.product = { findFirst: async () => null, create: async ({ data }) => { created = data; },
    findMany: async query => { expect(query.where.noteGroupAssignments).toEqual({ none: {} }); return [created]; } };
  db.stallProduct = { create: vi.fn() };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => saves.push(structuredClone(evidence)), clientFactory: async () => db });
  const evidence = await tool.preparePosProduct(); expect(evidence.rows).toHaveLength(1);
  expect(created.defaultPrice).toBe(100); expect(saves[0].relatedIds.stallProductIds).toHaveLength(1);
  expect(db.stallProduct.create).toHaveBeenCalledOnce();
});

test('inbox fixture does not enqueue delivery and reads only the actual personal read receipt', async () => {
  const { db } = mockDatabase(); let notification; const saves = [];
  db.billingNotification = { create: async ({ data }) => { notification = data; },
    findFirst: async () => ({ ...notification, dismissedAt: null }) };
  db.notificationReadReceipt = { findFirst: async query => {
    expect(query.where.billingNotificationId).toBe(notification.id); expect(query.where.profileId).toBe('owner');
    return { id: 'personal-read', readAt: new Date(now) };
  } };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => saves.push(structuredClone(evidence)), clientFactory: async () => db });
  const evidence = await tool.inbox(); expect(evidence.status).toBe('READBACK_VERIFIED');
  const read = await tool.inboxReadback(evidence); expect(read.status).toBe('UI_READ_PERSISTED');
  expect(saves[0].status).toBe('PLANNED'); expect(db.notificationOutbox).toBeUndefined();
});

test('synthetic invoice UI rows are 13 owned test orders and MOCK-only documents without provider operations', async () => {
  const { db } = mockDatabase(); const stores = new Map(); const saves = [];
  for (const model of ['invoiceSellerProfile', 'invoiceProviderConnection', 'invoicePolicyVersion']) {
    db[model] = { findUnique: async () => stores.get(model) ?? null, findFirst: async () => stores.get(model) ?? null,
      create: async ({ data }) => { stores.set(model, data); } };
  }
  for (const model of ['order', 'invoiceDocument']) db[model] = {
    createMany: async ({ data }) => { stores.set(model, data); }, findMany: async () => stores.get(model),
  };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => saves.push(structuredClone(evidence)), clientFactory: async () => db });
  const result = await tool.syntheticInvoices(); expect(result.rows).toHaveLength(13);
  expect(saves[0].relatedIds.orderIds).toHaveLength(13);
  expect(stores.get('order').every(row => row.isTest && row.origin === 'TEST' && row.paymentStatus === 'UNPAID')).toBe(true);
  expect(stores.get('invoiceDocument').every(row => row.testDocument && row.totalAmount === 100)).toBe(true);
  expect(stores.get('invoiceProviderConnection')).toMatchObject({ environment: 'MOCK', status: 'NOT_CONFIGURED' });
  expect(db.invoiceProviderOperation).toBeUndefined();
});

test('real seller configuration prevents synthetic invoice writes', async () => {
  const { db } = mockDatabase(); const save = vi.fn();
  db.invoiceSellerProfile = { findUnique: async () => ({ taxId: '12345678' }) };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => db });
  await expect(tool.syntheticInvoices()).rejects.toThrow('NON_MOCK_SELLER_DENIED'); expect(save).not.toHaveBeenCalled();
});

test.each(['missing-connection', 'production-connection', 'paid-order'])('rejects %s readback before verified invoice receipt', async failure => {
  const { db } = mockDatabase(); const stores = new Map(); const saves = [];
  for (const model of ['invoiceSellerProfile', 'invoiceProviderConnection', 'invoicePolicyVersion']) {
    db[model] = { findUnique: async () => null, findFirst: async () => {
      const actual = stores.get(model) ?? null;
      if (actual && model === 'invoiceProviderConnection' && failure === 'missing-connection') return null;
      if (actual && model === 'invoiceProviderConnection' && failure === 'production-connection') return { ...actual, environment: 'PRODUCTION' };
      return actual;
    }, create: async ({ data }) => { stores.set(model, data); } };
  }
  for (const model of ['order', 'invoiceDocument']) db[model] = {
    createMany: async ({ data }) => { stores.set(model, data); }, findMany: async () => {
      const rows = stores.get(model);
      return model === 'order' && failure === 'paid-order' ? rows.map((row, i) => i === 0 ? { ...row, paymentStatus: 'PAID' } : row) : rows;
    },
  };
  const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
    save: async evidence => saves.push(structuredClone(evidence)), clientFactory: async () => db });
  await expect(tool.syntheticInvoices()).rejects.toThrow('INVOICE_READBACK_FAILED');
  expect(saves).toHaveLength(1); expect(saves[0].status).toBe('PLANNED');
});

test.each(['2026-10-03T17:30:00Z', '2026-10-04T10:30:00Z', '2026-10-04T15:59:00Z'])('overnight fixture uses real Taipei weekday at %s', timestamp => {
  const instant = new Date(timestamp);
  const before = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek }));
  const rows = buildCalendarHours(before, 'OVERNIGHT', instant);
  expect(rows.filter(row => !row.isClosed)).toHaveLength(1);
  expect(isWithinBusinessHours(rows, 'Asia/Taipei', instant)).toBe(true);
  const open = rows.find(row => !row.isClosed); expect(open.opensAt > open.closesAt).toBe(true);
});

test('cutoff fixture respects current local minute and refuses midnight boundary', () => {
  const before = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek }));
  const rows = buildCalendarHours(before, 'CUTOFF', new Date('2026-10-04T10:30:00Z'));
  expect(rows.every(row => !row.isClosed && row.lastOrderAt === '18:28')).toBe(true);
  expect(() => buildCalendarHours(before, 'CUTOFF', new Date('2026-10-03T16:01:00Z'))).toThrow('CLOCK_BOUNDARY_PENDING');
});

test.each([false, true])('rejected order absence readback fails if rejected row exists: %s', exists => {
  return (async () => {
    const { db } = mockDatabase(); let reads = 0;
    const existingIds = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
    const rejectedIds = ['66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777'];
    db.order = { findMany: async () => ++reads === 1 ? (exists ? [{ id: rejectedIds[0] }] : []) : existingIds.map(id => ({ id, items: [{ quantity: 1 }] })) };
    const save = vi.fn(); const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now, save, clientFactory: async () => db });
    const { receipt, binding } = dbFixture(); const evidence = { resourceKey: receipt.resourceKey, childRef: binding.childRef,
      deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, phase: 'hours-closed', status: 'PASS', orderIds: existingIds,
      results: ['DEFAULT', 'DELIVERY'].map((mode, i) => ({ mode, rejectedCreateOrderId: rejectedIds[i], increaseUnchanged: true, decreasedQuantity: 1 })) };
    if (exists) { await expect(tool.verifyRejectedOrders(evidence)).rejects.toThrow('REJECTION_READBACK_FAILED'); expect(save).not.toHaveBeenCalled(); }
    else expect((await tool.verifyRejectedOrders(evidence)).status).toBe('READBACK_VERIFIED');
  })();
});

test.each([true, false])('future preorder uses canonical real-clock slots; available=%s', available => {
  return (async () => {
    const { db } = mockDatabase(); const saves = [];
    let settings = { organizationId: '11111111-1111-4111-8111-111111111111', stallId: '22222222-2222-4222-8222-222222222222',
      updatedAt: new Date(now), takeoutPreorderEnabled: false, preorderMinLeadMinutes: 5, preorderMaxDays: 7,
      preorderSlotMinutes: 5, businessDayCutoffHour: 4 };
    db.stallOrderingSettings = { findFirst: async () => structuredClone(settings), updateMany: async ({ data }) => {
      settings = { ...settings, ...data, updatedAt: new Date(now + 1) }; return { count: 1 };
    } };
    db.$queryRawUnsafe = vi.fn(async (sql, parameter) => {
      expect(sql).toBe('select public.get_takeout_preorder_slots($1::uuid, now()) as slots');
      expect(parameter).toBe('22222222-2222-4222-8222-222222222222');
      return [{ slots: available ? ['2026-10-04T09:00:00Z', '2026-10-04T09:30:00Z'] : [] }];
    });
    const tool = await createDatabaseFixtures({ ...dbFixture(), now: () => now,
      save: async evidence => saves.push(structuredClone(evidence)), clientFactory: async () => db });
    if (!available) {
      await expect(tool.preparePreorder()).rejects.toThrow('CANONICAL_SLOT_REQUIRED');
      expect(saves).toHaveLength(1); expect(saves[0].status).toBe('PLANNED');
    } else {
      const evidence = await tool.preparePreorder();
      expect(evidence.scheduledPickupAt).toBe('2026-10-04T09:00:00.000Z');
      expect(evidence.currentHoursClosed).toBe(true);
      expect(isWithinBusinessHours(evidence.after.hours, 'Asia/Taipei', new Date(now))).toBe(false);
      expect(isWithinBusinessHours(evidence.after.hours, 'Asia/Taipei', new Date(evidence.scheduledPickupAt))).toBe(true);
      await tool.restorePreorder(JSON.parse(JSON.stringify(evidence))); expect(settings.takeoutPreorderEnabled).toBe(false);
      expect(saves.at(-1).status).toBe('RESTORED');
    }
  })();
});
