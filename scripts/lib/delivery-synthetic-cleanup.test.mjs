import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import ts from "typescript";
import { test } from "vitest";

const source = readFileSync(new URL("../run-delivery-synthetic-smoke.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("run-delivery-synthetic-smoke.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ["cleanupSyntheticState", "deliveryActionDeduplicationPrefix", "sha256"].map((name) => {
  const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing actual script function: ${name}`);
  return declaration.getText(parsed);
});
const lifecycle = parsed.statements.find((node) => ts.isTryStatement(node) && node.finallyBlock);
assert.ok(lifecycle, "Missing actual script cleanup/disconnect lifecycle");
const executeCleanup = new (Object.getPrototypeOf(async function () {}).constructor)(
  "prisma", "state", "createHash",
  `const CONNECTION_ID = "de110000-0000-4000-8000-000000000001";
   const { syntheticOrderId, syntheticExternalOrderId, syntheticEventId, oauthTransactionId,
     sessionId, oauthSessionTokenHash } = state;
   ${functions.join("\n")}
   ${lifecycle.finallyBlock.getText(parsed)}`,
);

const owned = {
  syntheticOrderId: "order-owned",
  syntheticExternalOrderId: "external-owned",
  syntheticEventId: "event-owned",
  oauthTransactionId: "oauth-owned",
  sessionId: "session-staff-owned",
  oauthSessionTokenHash: "oauth-owned-hash",
};
const actionPrefix = "order-action:MOCK:de110000-0000-4000-8000-000000000001:"
  + createHash("sha256").update("external-owned").digest("hex") + ":";

function initialRows() {
  return {
    DeliverySyncJob: [
      { id: "import-owned", provider: "MOCK", deduplicationKey: "order-import:MOCK:external-owned" },
      { id: "action-owned", provider: "MOCK", deduplicationKey: `${actionPrefix}READY` },
      { id: "other-job", provider: "MOCK", deduplicationKey: "order-import:MOCK:external-other" },
    ],
    DeliveryWebhookEvent: [
      { id: "event-owned-row", provider: "MOCK", externalEventId: "event-owned" },
      { id: "other-event", provider: "MOCK", externalEventId: "event-other" },
    ],
    ExternalOrder: [
      { id: "external-owned-row", provider: "MOCK", externalOrderId: "external-owned", internalOrderId: "order-owned" },
      { id: "other-external", provider: "MOCK", externalOrderId: "external-other", internalOrderId: "order-other" },
    ],
    Order: [{ id: "order-owned", source: "MOCK", isTest: true }, { id: "order-other", source: "MOCK", isTest: true }],
    OAuthTransaction: [{ id: "oauth-owned", resultSessionId: "session-oauth-owned" }, { id: "other-oauth", resultSessionId: "session-other" }],
    AuthSession: [
      { id: "session-staff-owned", tokenHash: "staff-owned-hash" },
      { id: "session-oauth-owned", tokenHash: "oauth-owned-hash" },
      { id: "session-other", tokenHash: "other-hash" },
    ],
  };
}

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => key === "OR"
    ? value.some((part) => matches(row, part))
    : typeof value === "object" && value !== null
      ? typeof value.startsWith === "string" && row[key]?.startsWith(value.startsWith)
      : row[key] === value);
}

// Keep real Prisma lazy promises, serialization and transaction dispatch. Only the
// external query-engine boundary is replaced; no engine or database is started.
function database({ expireInteractiveAt = 0, failDeleteAt = 0, failLookup = false, rows = initialRows() } = {}) {
  const prisma = new PrismaClient({ datasourceUrl: "postgresql://fixture:fixture@127.0.0.1:1/fixture", errorFormat: "minimal" });
  let committed = structuredClone(rows);
  let interactive = null;
  let interactiveQueries = 0;
  let deleteQueries = 0;
  const trace = { starts: [], batches: [], queries: [], stops: 0, rollbacks: 0 };
  const expired = () => new Prisma.PrismaClientKnownRequestError(
    "Transaction API error: Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting.",
    { code: "P2028", clientVersion: Prisma.prismaVersion.client, meta: { modelName: "AuthSession" } },
  );
  function query(input, data) {
    trace.queries.push(structuredClone(input));
    const { modelName, action, query: { arguments: args } } = input;
    if (action === "findFirst") {
      if (failLookup) throw new Error("fixture lookup failure");
      const row = data[modelName].find((entry) => matches(entry, args.where));
      return { data: { [`findFirst${modelName}`]: row ? { internalOrderId: row.internalOrderId } : null } };
    }
    assert.equal(action, "deleteMany");
    deleteQueries += 1;
    if (failDeleteAt === deleteQueries) throw new Error("fixture delete failure");
    assert.ok(args.where && Object.keys(args.where).length, "Cleanup must retain its ownership filter");
    const removed = data[modelName].filter((row) => matches(row, args.where));
    if (modelName === "Order") {
      assert.equal(data.ExternalOrder.some((row) => removed.some((order) => order.id === row.internalOrderId)), false);
    }
    if (modelName === "AuthSession") {
      assert.equal(data.OAuthTransaction.some((row) => removed.some((session) => session.id === row.resultSessionId)), false);
    }
    data[modelName] = data[modelName].filter((row) => !matches(row, args.where));
    return { data: { [`deleteMany${modelName}`]: { count: removed.length } } };
  }
  prisma._engine = {
    async transaction(operation, _headers, options) {
      if (operation === "start") {
        trace.starts.push(options);
        interactive = structuredClone(committed);
        return { id: "fixture-interactive", payload: {} };
      }
      if (operation === "commit") committed = interactive;
      if (operation === "rollback") trace.rollbacks += 1;
      interactive = null;
    },
    async request(input, options) {
      if (options.interactiveTransaction) {
        interactiveQueries += 1;
        if (expireInteractiveAt && interactiveQueries >= expireInteractiveAt) {
          interactive = null;
          throw expired();
        }
        return query(input, interactive);
      }
      return query(input, committed);
    },
    async requestBatch(inputs, options) {
      trace.batches.push({ inputs: structuredClone(inputs), options: structuredClone(options) });
      assert.equal(options.transaction.kind, "batch");
      const pending = structuredClone(committed);
      const results = inputs.map((input) => query(input, pending));
      committed = pending;
      return results;
    },
    async stop() { trace.stops += 1; },
  };
  return { prisma, trace, rows: () => committed };
}

test("cleanup removes only owned state without requiring a surviving interactive transaction ID", async () => {
  const db = database({ expireInteractiveAt: 6 });
  await executeCleanup(db.prisma, owned, createHash);
  assert.deepEqual(Object.fromEntries(Object.entries(db.rows()).map(([name, rows]) => [name, rows.map((row) => row.id)])), {
    DeliverySyncJob: ["other-job"], DeliveryWebhookEvent: ["other-event"], ExternalOrder: ["other-external"],
    Order: ["order-other"], OAuthTransaction: ["other-oauth"], AuthSession: ["session-other"],
  });
  assert.equal(db.trace.starts.length, 0);
  assert.equal(db.trace.batches.length, 1);
  assert.deepEqual(db.trace.batches[0].inputs.map((query) => query.modelName), [
    "DeliverySyncJob", "DeliveryWebhookEvent", "ExternalOrder", "Order", "OAuthTransaction", "AuthSession", "AuthSession",
  ]);
  assert.equal(db.trace.stops, 1);
});

test("cleanup resolves a not-yet-recorded canonical order before the atomic delete batch", async () => {
  const db = database();
  await executeCleanup(db.prisma, { ...owned, syntheticOrderId: null }, createHash);
  assert.deepEqual(db.rows().Order.map((row) => row.id), ["order-other"]);
  assert.equal(db.trace.queries[0].action, "findFirst");
  assert.equal(db.trace.queries.filter((query) => query.action === "deleteMany").length, 7);
  assert.equal(db.trace.stops, 1);
});

test("a cleanup delete failure is propagated once and leaves every delete uncommitted", async () => {
  const db = database({ failDeleteAt: 6 });
  await assert.rejects(executeCleanup(db.prisma, owned, createHash), /fixture delete failure/);
  assert.deepEqual(db.rows(), initialRows());
  assert.equal(db.trace.queries.filter((query) => query.action === "deleteMany").length, 6);
  assert.equal(db.trace.stops, 1);
});

test("failed order lookup does not start deletion and still disconnects", async () => {
  const db = database({ failLookup: true });
  await assert.rejects(executeCleanup(db.prisma, { ...owned, syntheticOrderId: null }, createHash), /fixture lookup failure/);
  assert.deepEqual(db.rows(), initialRows());
  assert.equal(db.trace.starts.length + db.trace.batches.length, 0);
  assert.equal(db.trace.stops, 1);
});

test("OAuth-only failure cleanup keeps unrelated orders and sessions", async () => {
  const db = database();
  const state = Object.fromEntries(Object.keys(owned).map((key) => [key, null]));
  state.oauthTransactionId = owned.oauthTransactionId;
  state.oauthSessionTokenHash = owned.oauthSessionTokenHash;
  await executeCleanup(db.prisma, state, createHash);
  assert.deepEqual(db.rows().Order, initialRows().Order);
  assert.deepEqual(db.rows().AuthSession.map((row) => row.id), ["session-staff-owned", "session-other"]);
  assert.deepEqual(db.rows().OAuthTransaction.map((row) => row.id), ["other-oauth"]);
  assert.equal(db.trace.stops, 1);
});

test("cleanup with no created state leaves all rows untouched and disconnects", async () => {
  const db = database();
  await executeCleanup(db.prisma, Object.fromEntries(Object.keys(owned).map((key) => [key, null])), createHash);
  assert.deepEqual(db.rows(), initialRows());
  assert.equal(db.trace.queries.length, 0);
  assert.equal(db.trace.stops, 1);
});

test("matching external identifiers from another provider are preserved", async () => {
  const rows = initialRows();
  rows.DeliverySyncJob.push({ id: "real-job", provider: "UBEREATS", deduplicationKey: "order-import:MOCK:external-owned" });
  rows.DeliveryWebhookEvent.push({ id: "real-event", provider: "UBEREATS", externalEventId: "event-owned" });
  rows.ExternalOrder.push({ id: "real-external", provider: "UBEREATS", externalOrderId: "external-owned", internalOrderId: "real-order" });
  const db = database({ rows });
  await executeCleanup(db.prisma, owned, createHash);
  assert.deepEqual(db.rows().DeliverySyncJob.map((row) => row.id), ["other-job", "real-job"]);
  assert.deepEqual(db.rows().DeliveryWebhookEvent.map((row) => row.id), ["other-event", "real-event"]);
  assert.deepEqual(db.rows().ExternalOrder.map((row) => row.id), ["other-external", "real-external"]);
});

test("canonical deletion refuses a non-synthetic order even when its ID matches", async () => {
  const rows = initialRows();
  rows.Order[0].isTest = false;
  const db = database({ rows });
  await executeCleanup(db.prisma, owned, createHash);
  assert.deepEqual(db.rows().Order, rows.Order);
  assert.equal(db.trace.stops, 1);
});
