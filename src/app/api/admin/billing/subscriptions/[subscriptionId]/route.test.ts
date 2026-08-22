import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionId = "22222222-2222-4222-8222-222222222222";
const changeRequestId = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  migrateSubscription: vi.fn(),
  closeBillingPeriod: vi.fn(),
  assignOrderPackage: vi.fn(),
  rebuildUsageSummary: vi.fn(),
  transitionSubscription: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizePlatformAdminApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/server/billing/billing-workflow-http", () => ({
  billingWorkflowErrorResponse: () => null,
}));
vi.mock("@/server/billing/billing-workflow-service", () => ({
  billingWorkflowService: {
    assignOrderPackage: mocks.assignOrderPackage,
    rebuildUsageSummary: mocks.rebuildUsageSummary,
    transitionSubscription: mocks.transitionSubscription,
  },
}));
vi.mock("@/server/billing/payg-billing-service", () => ({
  PaygBillingError: class extends Error {},
  paygBillingService: {
    migrateSubscription: mocks.migrateSubscription,
    closeBillingPeriod: mocks.closeBillingPeriod,
  },
}));

describe("platform admin PAYG subscription route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      ok: true,
      requestId: "request-id",
      principal: { user: { id: "33333333-3333-4333-8333-333333333333" } },
    });
    mocks.validateCsrf.mockReturnValue(true);
    mocks.migrateSubscription.mockResolvedValue({ id: subscriptionId });
  });

  it("forwards the validated change request identifier to PAYG migration", async () => {
    mocks.readJson.mockResolvedValue({
      data: {
        operation: "MIGRATE_TO_PAYG",
        effectiveDate: "2026-08-01",
        confirmation: "MIGRATE_TO_PAYG",
        changeRequestId,
        reason: "核准商家 PAYG 申請",
      },
    });

    const response = await patchSubscription();

    expect(response.status).toBe(200);
    expect(mocks.migrateSubscription).toHaveBeenCalledWith(
      subscriptionId,
      {
        effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
        confirmation: "MIGRATE_TO_PAYG",
        changeRequestId,
        reason: "核准商家 PAYG 申請",
      },
      {
        actorProfileId: "33333333-3333-4333-8333-333333333333",
        requestId: "request-id",
        ipHash: "ip-hash",
      },
    );
  });
});

async function patchSubscription() {
  const route = await import("./route");
  return route.PATCH(
    new Request(`https://local.test/api/admin/billing/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: "{}",
    }),
    { params: Promise.resolve({ subscriptionId }) },
  );
}
