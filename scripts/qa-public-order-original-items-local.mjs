// Local DB seam regression. Does not apply migrations or start services.
// Run: node --env-file=.env.local scripts/qa-public-order-original-items-local.mjs
// Requires UI_UX_QA=true and PLAYWRIGHT_APP_URL=http://127.0.0.1:3023.
// Creates only dedicated fixtures, retained for inspection. No global deletes.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

function guard() {
  const db = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
  const app = new URL(process.env.PLAYWRIGHT_APP_URL ?? "http://invalid");
  if (process.env.CI === "true" && app.href === "http://127.0.0.1:3000/"
    && db.hostname === "127.0.0.1" && db.port === "54322" && db.pathname === "/postgres"
    && ["postgres:", "postgresql:"].includes(db.protocol)) return;
  assert.equal(process.env.UI_UX_QA, "true", "LOCAL_QA_REQUIRED");
  assert.equal(app.href, "http://127.0.0.1:3023/", "LOCAL_APP_3023_REQUIRED");
  assert.ok(["postgres:", "postgresql:"].includes(db.protocol), "POSTGRES_REQUIRED");
  assert.equal(db.hostname, "127.0.0.1", "LOCAL_DB_REQUIRED");
  assert.equal(db.port, "55722", "LOCAL_DB_55722_REQUIRED");
  assert.equal(db.pathname, "/postgres", "LOCAL_POSTGRES_DB_REQUIRED");
}
guard();
const db = new PrismaClient();
const hash = () => randomBytes(32).toString("hex");
const orgId = randomUUID();
const stallId = randomUUID();
const slug = `qa-items-replay-${Date.now()}-${randomUUID().slice(0, 6)}`;
const qrToken = `qa-items-replay-${randomUUID()}`;
const qrId = randomUUID();
const passes = [];
let productId;
let stage = "fixture";

async function check(name, action) {
  guard();
  stage = name;
  await action();
  passes.push(name);
  console.log(`PASS ${name}`);
}
async function digest(items) {
  const rows = await db.$queryRaw`select app_private.public_order_items_digest_v1(${JSON.stringify(items)}::jsonb) as digest`;
  return rows[0].digest;
}
function items(quantity = 1, note = "") {
  return [{ product_id: productId, quantity, note, modifier_option_ids: [], bundle_choice_ids: [] }];
}
async function session(orderingMode = "DEFAULT", requestedFulfillmentAt = null) {
  const input = { id: randomUUID(), sessionHash: hash(), deviceHash: hash(), ipHash: hash(), qrHash: hash(), behaviorHash: hash(), idempotencyHash: hash(), idempotencyKey: randomUUID(), orderId: randomUUID(), trackingHash: hash(), pickupHash: hash(), orderingMode, requestedFulfillmentAt };
  await db.orderSession.create({ data: {
    id: input.id, organizationId: orgId, stallId, qrCodeId: qrId,
    tokenHash: input.sessionHash, deviceHash: input.deviceHash, ipHash: input.ipHash,
    status: "ACTIVE", orderingMode, requestedFulfillmentAt, expiresAt: new Date(Date.now() + 3600_000),
  } });
  return input;
}
async function create(input, cart, client = db, legacy = false) {
  const functionName = legacy
    ? Prisma.raw("public.create_public_order_with_fulfillment_time_targeted")
    : Prisma.raw("public.create_public_order_with_daily_pickup_code_targeted");
  const rows = await client.$queryRaw(Prisma.sql`select ${functionName}(
    ${input.orderId}::uuid, ${qrToken}::text, ${input.sessionHash}::text,
    ${input.deviceHash}::text, ${input.ipHash}::text, ${input.qrHash}::text,
    ${input.behaviorHash}::text, ${input.idempotencyKey}::uuid, ${input.idempotencyHash}::text,
    '本機驗收顧客'::text, '0900000000'::text, '本機測試地址'::text, '本機原始品項重送驗收'::text,
    ${JSON.stringify(cart)}::jsonb, ${input.trackingHash}::text, ${input.pickupHash}::text,
    ${randomUUID()}::text, true::boolean, ${input.requestedFulfillmentAt}::timestamptz, null::uuid
  ) as result`);
  return rows[0].result;
}
async function preflight(input, cart) {
  const rows = await db.$queryRaw`select public.public_order_preflight_with_special_closure(
    'ORDER'::text, ${qrToken}::text, ${input.orderingMode}::text, ${input.deviceHash}::text,
    ${input.ipHash}::text, ${input.qrHash}::text, ${input.behaviorHash}::text,
    ${randomUUID()}::text, ${input.sessionHash}::text, ${input.idempotencyKey}::uuid,
    ${input.idempotencyHash}::text, ${input.requestedFulfillmentAt}::timestamptz, null::uuid,
    ${JSON.stringify(cart)}::jsonb, true::boolean, null::text
  ) as result`;
  return rows[0].result;
}
async function storedDigest(input) {
  const rows = await db.$queryRaw`select original_items_digest from public.order_sessions where id = ${input.id}::uuid`;
  return rows[0].original_items_digest;
}
async function businessState() {
  const [orders, stock] = await Promise.all([
    db.order.findMany({ where: { stallId }, orderBy: { id: "asc" }, select: { id: true, total: true, status: true, paymentStatus: true, items: { orderBy: { id: "asc" }, select: { id: true, quantity: true, note: true } } } }),
    db.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId } }, select: { stockRemaining: true } }),
  ]);
  return JSON.stringify({ orders, stock });
}

try {
  const plan = await db.planVersion.findFirstOrThrow({ where: { plan: { code: "TRIAL" }, effectiveUntil: null } });
  await db.organization.create({ data: { id: orgId, name: "原始品項重送 QA", slug, businessName: "本機驗收", status: "ACTIVE", email: `${slug}@stallorder.test`, phone: "0900000000" } });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.planId, planVersionId: plan.id, status: "ACTIVE", billingInterval: "MONTHLY", billingPeriodStart: new Date(), billingPeriodEnd: new Date(Date.now() + 30 * 86400_000) } });
  await db.stall.create({ data: { id: stallId, organizationId: orgId, name: "原始品項重送 QA", slug, code: slug, address: "本機", location: "本機", isActive: true, businessStatus: "OPEN", orderingState: "OPEN", orderingEnabled: true } });
  await db.stallOrderingSettings.create({ data: { organizationId: orgId, stallId, lotteryEnabled: false, takeoutPreorderEnabled: true, deliveryModuleEnabled: true } });
  await db.stallBusinessHour.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId: orgId, stallId, dayOfWeek, opensAt: "00:00", closesAt: "00:00", isClosed: false })) });
  const category = await db.productCategory.create({ data: { organizationId: orgId, name: "原始品項重送 QA" } });
  productId = (await db.product.create({ data: { organizationId: orgId, categoryId: category.id, name: "重送驗收餐", description: "本機原始品項重送專用", defaultPrice: 50, stallProducts: { create: { organizationId: orgId, stallId, isEnabled: true, stockRemaining: 100 } } } })).id;
  await db.qrCode.create({ data: { id: qrId, organizationId: orgId, stallId, token: qrToken, tokenVersion: 1, label: "原始品項重送 QA", state: "ACTIVE" } });

  await check("normalization-and-order-insensitive-selection", async () => {
    const optionIds = [randomUUID(), randomUUID()];
    const bundleIds = [randomUUID(), randomUUID()];
    const cart = [{ ...items(2, " 不辣 ")[0], modifier_option_ids: optionIds, bundle_choice_ids: bundleIds }, { ...items()[0], product_id: randomUUID() }];
    const expected = await digest(cart);
    assert.match(expected, /^v1:[a-f0-9]{64}$/);
    const reordered = [cart[1], { ...cart[0], product_id: productId.toUpperCase(), note: "不辣", modifier_option_ids: [...optionIds].reverse(), bundle_choice_ids: [...bundleIds].reverse() }];
    assert.equal(await digest(reordered), expected);
    for (const difference of [{ quantity: 3 }, { note: "少辣" }, { modifier_option_ids: [randomUUID()] }, { bundle_choice_ids: [randomUUID()] }]) {
      assert.notEqual(await digest([{ ...cart[0], ...difference }, cart[1]]), expected);
    }
    assert.equal(await digest([{ product_id: productId, quantity: 1 }]), await digest(items()));
  });

  const original = await session();
  await check("first-create-binds-and-both-replay-gates-reject-changes", async () => {
    const created = await create(original, items(2, "不辣"));
    assert.equal(created.ok, true, `create failed: ${created.code}`);
    assert.equal(created.idempotent_replay, false);
    const expected = await digest(items(2, "不辣"));
    assert.equal(await storedDigest(original), expected);
    const before = await businessState();
    for (const cart of [items(3, "不辣"), items(2, "少辣"), [{ ...items(2, "不辣")[0], modifier_option_ids: [randomUUID()] }], [{ ...items(2, "不辣")[0], bundle_choice_ids: [randomUUID()] }]]) {
      for (const response of [await preflight(original, cart), await create(original, cart)]) {
        assert.equal(response.ok, false);
        assert.equal(response.code, "IDEMPOTENCY_CONFLICT");
      }
    }
    assert.equal(await businessState(), before);
    assert.equal(await storedDigest(original), expected);
    assert.equal((await preflight(original, items(2, " 不辣 "))).ok, true);
    assert.equal((await create(original, items(2, " 不辣 "))).idempotent_replay, true);
  });

  await check("failed-create-does-not-bind", async () => {
    const failed = await session();
    const response = await create(failed, items(0));
    assert.equal(response.ok, false);
    assert.equal(await storedDigest(failed), null);
    assert.equal(await db.order.count({ where: { id: failed.orderId } }), 0);
  });

  await check("concurrent-same-session-same-cart-creates-one-order", async () => {
    const same = await session();
    const replies = await Promise.all([create(same, items()), create(same, items())]);
    assert.ok(replies.every((reply) => reply.ok), replies.map((reply) => reply.code).join(","));
    assert.deepEqual(replies.map((reply) => reply.idempotent_replay).sort(), [false, true]);
    assert.equal(await db.order.count({ where: { id: same.orderId } }), 1);
    assert.equal(await storedDigest(same), await digest(items()));
  });

  await check("concurrent-same-session-different-cart-rejects-loser", async () => {
    const different = await session();
    const carts = [items(1), items(2)];
    const replies = await Promise.all(carts.map((cart) => create(different, cart)));
    const winner = replies.findIndex((reply) => reply.ok);
    assert.ok(winner >= 0);
    assert.equal(replies.filter((reply) => reply.ok).length, 1);
    assert.equal(replies[1 - winner].code, "IDEMPOTENCY_CONFLICT");
    assert.equal(await db.order.count({ where: { id: different.orderId } }), 1);
    assert.equal(await storedDigest(different), await digest(carts[winner]));
  });

  await check("amended-storage-does-not-redefine-original-cart", async () => {
    // Deliberate DB seam simulation, rolled back; this is not staff UI evidence.
    const marker = new Error("ROLLBACK_AMENDED_STORAGE_FIXTURE");
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.orderItem.updateMany({ where: { orderId: original.orderId }, data: { note: "店員修改後的內容" } });
      const replay = await create(original, items(2, "不辣"), tx);
      assert.equal(replay.ok, true);
      assert.equal(replay.idempotent_replay, true);
      assert.equal((await create(original, items(2, "店員修改後的內容"), tx)).code, "IDEMPOTENCY_CONFLICT");
      throw marker;
    }), (error) => error === marker);
  });

  await check("legacy-null-remains-unbound-on-replay", async () => {
    const legacy = await session();
    // The historical inner RPC creates the pre-migration shape without forging
    // or clearing a non-null immutable digest.
    const created = await create(legacy, items(), db, true);
    assert.equal(created.ok, true, `legacy create failed: ${created.code}`);
    assert.equal(await storedDigest(legacy), null);
    assert.equal((await preflight(legacy, items(2))).ok, true);
    const replay = await create(legacy, items(2));
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(await storedDigest(legacy), null);
  });

  await check("saved-digest-cannot-be-cleared-or-overwritten", async () => {
    for (const value of [null, `v1:${hash()}`]) {
      await assert.rejects(db.$executeRaw`update public.order_sessions set original_items_digest = ${value}::text where id = ${original.id}::uuid`, /ORIGINAL_ITEMS_DIGEST_IMMUTABLE/);
    }
  });

  for (const orderingMode of ["PREORDER", "DELIVERY"]) {
    await check(`${orderingMode.toLowerCase()}-create-and-replay-preserves-original-items`, async () => {
      let slot = null;
      if (orderingMode === "PREORDER") {
        const rows = await db.$queryRaw`select public.get_fulfillment_time_slots_raw(${stallId}::uuid, now()) as slots`;
        assert.ok(rows[0].slots.length > 2, "dedicated fixture must expose real preorder slots");
        slot = new Date(rows[0].slots[2]);
        assert.ok(slot.getTime() > Date.now());
      }
      const input = await session(orderingMode, slot);
      const cart = items(2, `${orderingMode} 原始品項`);
      const created = await create(input, cart);
      assert.equal(created.ok, true, `${orderingMode} create failed: ${created.code}`);
      assert.equal(created.idempotent_replay, false);
      const order = await db.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { fulfillmentType: true, total: true, requestedFulfillmentAt: true, deliveryAddress: true } });
      assert.equal(order.fulfillmentType, orderingMode === "DELIVERY" ? "DELIVERY" : "TAKEOUT");
      assert.equal(order.total, 100);
      if (slot) assert.equal(order.requestedFulfillmentAt?.getTime(), slot.getTime());
      if (orderingMode === "DELIVERY") assert.equal(order.deliveryAddress, "本機測試地址");
      assert.equal(await storedDigest(input), await digest(cart));
      const before = await businessState();
      assert.equal((await preflight(input, cart)).ok, true);
      assert.equal((await create(input, cart)).idempotent_replay, true);
      const changed = [{ ...cart[0], quantity: 3 }];
      assert.equal((await preflight(input, changed)).code, "IDEMPOTENCY_CONFLICT");
      assert.equal((await create(input, changed)).code, "IDEMPOTENCY_CONFLICT");
      assert.equal(await businessState(), before);
      assert.equal(await db.order.count({ where: { id: input.orderId } }), 1);
    });
  }

  await check("real-modifier-and-bundle-expansion-retains-original-cart", async () => {
    // Reuse the catalog's real note/bundle models; no replacement pricing logic.
    const noteGroup = await db.productNoteGroup.create({ data: { organizationId: orgId, name: "重送 QA 加料", selectionMode: "MULTIPLE", minSelections: 0, maxSelections: 2 } });
    const option = await db.productNoteOption.create({ data: { organizationId: orgId, noteGroupId: noteGroup.id, name: "QA 加料", priceDelta: 10 } });
    const bundle = await db.product.create({ data: { organizationId: orgId, categoryId: category.id, name: "重送 QA 套餐", description: "本機套餐與註記摘要驗收", kind: "BUNDLE", defaultPrice: 100, stallProducts: { create: { organizationId: orgId, stallId, isEnabled: true, stockRemaining: 20 } } } });
    const choiceGroup = await db.productBundleChoiceGroup.create({ data: { organizationId: orgId, bundleProductId: bundle.id, name: "QA 主餐", minSelections: 1, maxSelections: 1 } });
    const choice = await db.productBundleChoice.create({ data: { organizationId: orgId, choiceGroupId: choiceGroup.id, componentProductId: productId, quantity: 2, priceDelta: 20 } });
    await db.productNoteGroupAssignment.createMany({ data: [productId, bundle.id].map((id) => ({ organizationId: orgId, productId: id, noteGroupId: noteGroup.id })) });
    for (const [kind, id, choices, total] of [["modifier", productId, [], 60], ["bundle-and-modifier", bundle.id, [choice.id], 130]]) {
      const input = await session();
      const cart = [{ product_id: id, quantity: 1, note: "原始備註", modifier_option_ids: [option.id], bundle_choice_ids: choices }];
      const created = await create(input, cart);
      assert.equal(created.ok, true, `${kind} create failed: ${created.code}`);
      const order = await db.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { total: true, items: { select: { unitPrice: true, noteOptions: { select: { optionName: true, priceDelta: true } } } } } });
      assert.equal(order.total, total);
      assert.equal(order.items.length, 1);
      assert.equal(order.items[0].unitPrice, total);
      assert.equal(order.items[0].noteOptions.length, choices.length + 1);
      assert.equal(await storedDigest(input), await digest(cart));
      assert.equal((await preflight(input, cart)).ok, true);
      assert.equal((await create(input, cart)).idempotent_replay, true);
      const changed = [{ ...cart[0], modifier_option_ids: [] }];
      assert.equal((await preflight(input, changed)).code, "IDEMPOTENCY_CONFLICT");
      assert.equal((await create(input, changed)).code, "IDEMPOTENCY_CONFLICT");
      assert.equal(await storedDigest(input), await digest(cart));
    }
  });

  await check("targeted-session-and-order-lookup-plan", async () => {
    const plan = await db.$queryRaw`explain (analyze, buffers, format json)
      select session_record.id, session_record.original_items_digest
      from public.order_sessions session_record
      join public.orders order_record on order_record.id = session_record.order_id
      where session_record.token_hash = ${original.sessionHash}
        and order_record.idempotency_key = ${original.idempotencyKey}::uuid`;
    assert.ok(plan[0]["QUERY PLAN"][0].Plan);
    // No tokens/query text printed. Small-table sequential scans are not failures.
    console.log(`Lookup execution ms: ${plan[0]["QUERY PLAN"][0]["Execution Time"]}`);
  });
  console.log(JSON.stringify({ status: "PASS", cases: passes.length, fixture: { organizationId: orgId, stallId, slug }, boundary: "local trusted RPC and database; not full browser, provider, or Production proof" }));
} catch (error) {
  // Prisma exceptions can embed invocation arguments, including fixture hashes.
  const validation = error?.message?.match(/(?:Unknown argument [`'][A-Za-z0-9_]+[`']|Argument [`'][A-Za-z0-9_]+[`'] is missing)/g) ?? [];
  const databaseCode = typeof error?.meta?.code === "string" && /^[0-9A-Z]{5}$/.test(error.meta.code) ? error.meta.code : undefined;
  const databaseSignal = typeof error?.meta?.message === "string" ? error.meta.message.match(/\b[A-Z][A-Z_]+_[A-Z_]+\b/g)?.slice(0, 4) : undefined;
  console.error(JSON.stringify({ status: "FAIL", stage, completedCases: passes, fixture: { organizationId: orgId, stallId, slug }, errorType: error?.constructor?.name, validation, databaseCode, databaseSignal, reason: error instanceof assert.AssertionError ? error.message.replace(/\b[0-9a-f]{32,}\b/gi, "<REDACTED>") : "DATABASE_OR_RUNTIME_FAILURE" }));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
