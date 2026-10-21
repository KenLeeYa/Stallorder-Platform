import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const state = vi.hoisted(() => ({ job: {} as Record<string, unknown>, order: {} as Record<string, unknown>, writes: [] as string[] }));
const id = "11111111-1111-4111-8111-111111111111";
const recipientReference = "33333333-3333-4333-8333-333333333333";
const claim = { id, token: "22222222-2222-4222-8222-222222222222" };
const settings = { displayName: "Mock", officialAccountUrl: "", notifyConfirmed: true, notifyReady: true, notifyCancelled: true, webhookManagement: { version: 0, localMock: true, messagingChannelId: "9990004", senderPolicy: "MERCHANT_OA" } };
const raw = JSON.stringify({ jobId: id, recipient: "synthetic-recipient", text: "Frozen notification" });
const payloadHash = createHash("sha256").update(raw).digest("hex");
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("select * from public.notification_jobs")) return [state.job];
      if (sql.includes("select sender_scope")) return [{ sender_scope: "LEGACY", environment: "local", provider_id: "9990001", oa_destination: "destination", quota_limit: 30, quota_usage: 0, paused_until: null }];
      if (sql.includes("clock_timestamp() as now")) return [{ now: new Date("2030-01-01T00:00:00Z") }];
      if (sql.includes("billing_feature_flags")) return [{ code: "OPEN_BETA_FREE_ACCESS_ENABLED" }];
      return [];
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => { state.writes.push(strings.join("?")); return 1; }),
    notificationIntegration: { findUniqueOrThrow: vi.fn(async () => ({ id, organizationId: id, stallId: id, provider: "LINE", status: "ACTIVE", secretReference: id, publicIdentifier: "9990003", settingsJson: settings })) },
    customerContactLink: { findUniqueOrThrow: vi.fn(async () => ({ integrationId: id, customerReferenceId: id, provider: "LINE", organizationId: id, stallId: id, consentStatus: "GRANTED", revokedAt: null, providerUserSecretReference: recipientReference, providerUserIdHash: createHash("sha256").update("synthetic-recipient").digest("hex") })) },
    order: { findUniqueOrThrow: vi.fn(async () => state.order) },
  };
  return { prisma: { $transaction: vi.fn(async callback => callback(tx)) } };
});
vi.mock("./notification-secrets", () => ({ readNotificationSecret: vi.fn(async (reference: string) => JSON.stringify(reference === id ? { channelAccessToken: "synthetic-access-token", messagingChannelSecret: "synthetic-channel-secret", loginChannelSecret: "synthetic-login-secret" } : { providerUserId: "synthetic-recipient", providerId: "9990001", trackingToken: "x".repeat(40) })) }));
vi.mock("@/server/billing/entitlement-service", () => ({ EntitlementService: class { async assertFeatureEnabled() {} } }));
vi.mock("@/server/line-platform/crypto", () => ({ decryptPlatformValue: () => raw }));
vi.mock("./line-messaging-provider", () => ({ getLegacyLineMockTransport: () => fetch }));
import { authorizeLegacyEffect, prepareLegacyNotification } from "./legacy-notification-execution";
import { renderLineNotification } from "./notification-job-processor";

beforeEach(() => {
  vi.clearAllMocks(); state.writes = []; vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  const recipientHash = createHash("sha256").update("synthetic-recipient").digest("hex");
  state.job = { id, organization_id: id, stall_id: id, order_id: id, integration_id: id, contact_link_id: id, recipient_reference: recipientReference, recipient_identity_hash: recipientHash, template_code: "ORDER_READY", template_version: 1, event_version: 0, retry_key: id, environment: "local", snapshot_ciphertext: "frozen-ciphertext", payload_hash: payloadHash, legacy_intent_json: { version: 1, purpose: "LOCAL_MOCK_TEST", organizationId: id, stallId: id, orderId: id, integrationId: id, contactLinkId: id, recipientReference, recipientHash, providerId: "9990001", environment: "local", destination: "destination", secretRevision: id, loginChannelId: "9990003", messagingChannelId: "9990004", policy: "MERCHANT_OA", notifyConfirmed: true, notifyReady: true, notifyCancelled: true, templateVersion: 1 } };
  state.order = { organizationId: id, stallId: id, status: "READY", isTest: true, stall: { isActive: true }, organization: { status: "ACTIVE" }, fulfillmentTimeState: "CUSTOMER_ACTION_REQUIRED", fulfillmentTimeVersion: 1, pendingFulfillmentAt: new Date("2030-01-01T01:00:00Z"), fulfillmentTimeResponseExpiresAt: new Date("2030-01-01T00:30:00Z") };
});
const invalid = [
  ["READY after cancellation", "ORDER_READY", 0, { status: "CANCELLED" }],
  ["READY after completion", "ORDER_READY", 0, { status: "COMPLETED" }],
  ["confirmation after readiness", "ORDER_CONFIRMED", 0, { status: "READY" }],
  ["confirmation before acceptance", "ORDER_CONFIRMED", 0, { status: "PENDING" }],
  ["confirmation after expiry", "ORDER_CONFIRMED", 0, { status: "EXPIRED" }],
  ["cancellation while preparing", "ORDER_CANCELLED", 0, { status: "PREPARING" }],
  ["ordinary version must be zero", "ORDER_READY", 1, { status: "READY" }],
  ["proposal superseded version", "FULFILLMENT_TIME_PROPOSED", 1, { fulfillmentTimeVersion: 2 }],
  ["proposal no longer awaiting customer", "FULFILLMENT_TIME_PROPOSED", 1, { fulfillmentTimeState: "CONFIRMED" }],
  ["proposal missing pending time", "FULFILLMENT_TIME_PROPOSED", 1, { pendingFulfillmentAt: null }],
  ["proposal missing deadline", "FULFILLMENT_TIME_PROPOSED", 1, { fulfillmentTimeResponseExpiresAt: null }],
  ["proposal expired at database clock", "FULFILLMENT_TIME_PROPOSED", 1, { fulfillmentTimeResponseExpiresAt: new Date("2030-01-01T00:00:00Z") }],
  ...["COMPLETED", "CANCELLED", "EXPIRED"].map(status => ["proposal terminal " + status, "FULFILLMENT_TIME_PROPOSED", 1, { status }] as const),
] as const;
describe.each(["prepare", "authorize"] as const)("legacy current event %s gate", gate => {
  it.each(invalid)("suppresses %s without effect or quota", async (_label, template, version, changes) => {
    state.job.template_code = template; state.job.event_version = version; Object.assign(state.order, changes);
    const before = JSON.stringify(state.job);
    const result = gate === "prepare" ? await prepareLegacyNotification(claim, renderLineNotification) : await authorizeLegacyEffect(claim, payloadHash);
    expect(result).toMatchObject({ status: "PAUSED", reason: "LEGACY_ORDER_EVENT_SUPERSEDED" });
    expect(state.writes).toHaveLength(1); expect(state.writes[0]).toContain("outcome='SUPPRESSED'");
    expect(JSON.stringify(state.job)).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([["ORDER_CONFIRMED", "CONFIRMED", 0], ["ORDER_CONFIRMED", "PREPARING", 0], ["ORDER_READY", "READY", 0], ["ORDER_CANCELLED", "CANCELLED", 0], ["FULFILLMENT_TIME_PROPOSED", "CONFIRMED", 1]] as const)("retains valid %s in %s", async (template, status, version) => {
    state.job.template_code = template; state.job.event_version = version; state.order.status = status;
    const result = gate === "prepare" ? await prepareLegacyNotification(claim, renderLineNotification) : await authorizeLegacyEffect(claim, payloadHash);
    if (gate === "prepare") { expect(result).toMatchObject({ hash: payloadHash, message: JSON.parse(raw) }); expect(state.writes).toHaveLength(0); }
    else { expect(result).toMatchObject({ token: "synthetic-access-token" }); expect(state.writes).toHaveLength(2); }
    expect(fetch).not.toHaveBeenCalled();
  });
});
