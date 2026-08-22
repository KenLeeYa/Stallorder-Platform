import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transactionRunner: vi.fn(),
  transaction: {
    $queryRaw: vi.fn(),
    subscription: { findUnique: vi.fn() },
    planVersion: { findFirst: vi.fn(), findUnique: vi.fn() },
    billingFeatureFlag: { findMany: vi.fn() },
    billingChangeRequest: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    invoice: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transactionRunner },
}));

import { BillingWorkflowService } from "./billing-workflow-service";

const context = {
  actorProfileId: "55555555-5555-4555-8555-555555555551",
  requestId: "payg-request-test",
};

const paygVersion = {
  id: "payg-v1",
  billingInterval: "MONTHLY",
  annualPrice: null,
  pricingMode: "USAGE_PER_STALL_CAPPED",
  plan: { code: "PAYG" },
};

describe("BillingWorkflowService PAYG request boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionRunner.mockImplementation(async (
      operation: (transaction: typeof mocks.transaction) => Promise<unknown>,
    ) => operation(mocks.transaction));
    mocks.transaction.subscription.findUnique.mockResolvedValue({
      id: "subscription-id",
      plan: { code: "PRO" },
      planVersion: { pricingMode: "FIXED" },
    });
    mocks.transaction.planVersion.findFirst.mockResolvedValue(paygVersion);
    mocks.transaction.billingFeatureFlag.findMany.mockResolvedValue([]);
    mocks.transaction.billingChangeRequest.create.mockResolvedValue({ id: "request-id" });
    mocks.transaction.auditLog.create.mockResolvedValue({ id: "audit-id" });
  });

  it("rejects a PAYG request while the PAYG core flag is off", async () => {
    mocks.transaction.billingFeatureFlag.findMany.mockResolvedValue([
      { code: "PAYG_LEGACY_MIGRATION_ENABLED", isEnabled: true },
    ]);

    await expect(new BillingWorkflowService().requestPlanChange(
      "organization-id",
      { planVersionId: "payg-v1", billingInterval: "MONTHLY", reason: "move to PAYG" },
      context,
    )).rejects.toMatchObject({ code: "PLAN_VERSION_NOT_AVAILABLE" });

    expect(mocks.transaction.billingChangeRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a legacy PAYG request until the legacy migration flag is on", async () => {
    mocks.transaction.billingFeatureFlag.findMany.mockResolvedValue([
      { code: "PAYG_BILLING_ENABLED", isEnabled: true },
    ]);

    await expect(new BillingWorkflowService().requestPlanChange(
      "organization-id",
      { planVersionId: "payg-v1", billingInterval: "MONTHLY", reason: "move to PAYG" },
      context,
    )).rejects.toMatchObject({ code: "PLAN_VERSION_NOT_AVAILABLE" });
  });

  it("creates only a pending request when the dedicated PAYG migration path is enabled", async () => {
    mocks.transaction.billingFeatureFlag.findMany.mockResolvedValue([
      { code: "PAYG_BILLING_ENABLED", isEnabled: true },
      { code: "PAYG_LEGACY_MIGRATION_ENABLED", isEnabled: true },
    ]);

    await expect(new BillingWorkflowService().requestPlanChange(
      "organization-id",
      { planVersionId: "payg-v1", billingInterval: "MONTHLY", reason: "move to PAYG" },
      context,
    )).resolves.toEqual({ id: "request-id" });

    expect(mocks.transaction.billingChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestType: "PLAN_CHANGE",
        requestedPlanVersionId: "payg-v1",
        requestedBillingInterval: "MONTHLY",
      }),
    });
    expect(mocks.transaction.invoice.create).not.toHaveBeenCalled();
  });

  it("keeps fixed-price legacy plan requests working while PAYG flags are off", async () => {
    mocks.transaction.planVersion.findFirst.mockResolvedValue({
      id: "pro-v1",
      billingInterval: "MONTHLY",
      annualPrice: null,
      pricingMode: "FIXED",
      plan: { code: "PRO" },
    });

    await expect(new BillingWorkflowService().requestPlanChange(
      "organization-id",
      { planVersionId: "pro-v1", billingInterval: "MONTHLY", reason: "legacy renewal" },
      context,
    )).resolves.toEqual({ id: "request-id" });

    expect(mocks.transaction.billingFeatureFlag.findMany).not.toHaveBeenCalled();
  });

  it("does not let a PAYG subscription request a legacy fixed-price plan", async () => {
    mocks.transaction.subscription.findUnique.mockResolvedValue({
      id: "subscription-id",
      plan: { code: "PAYG" },
      planVersion: { pricingMode: "USAGE_PER_STALL_CAPPED" },
    });
    mocks.transaction.planVersion.findFirst.mockResolvedValue({
      id: "pro-v1",
      billingInterval: "MONTHLY",
      annualPrice: null,
      pricingMode: "FIXED",
      plan: { code: "PRO" },
    });

    await expect(new BillingWorkflowService().requestPlanChange(
      "organization-id",
      { planVersionId: "pro-v1", billingInterval: "MONTHLY", reason: "legacy plan" },
      context,
    )).rejects.toMatchObject({ code: "PLAN_VERSION_NOT_AVAILABLE" });
  });

  it("rejects legacy additional-stall requests for PAYG subscriptions", async () => {
    mocks.transaction.subscription.findUnique.mockResolvedValue({
      id: "subscription-id",
      planVersion: { pricingMode: "USAGE_PER_STALL_CAPPED" },
    });

    await expect(new BillingWorkflowService().requestAdditionalStalls(
      "organization-id",
      { quantity: 1, reason: "second stall" },
      context,
    )).rejects.toMatchObject({ code: "ADD_ON_NOT_AVAILABLE" });

    expect(mocks.transaction.billingChangeRequest.create).not.toHaveBeenCalled();
  });

  it("keeps additional-stall requests available for fixed-price legacy subscriptions", async () => {
    mocks.transaction.subscription.findUnique.mockResolvedValue({
      id: "subscription-id",
      planVersion: { pricingMode: "FIXED" },
    });

    await expect(new BillingWorkflowService().requestAdditionalStalls(
      "organization-id",
      { quantity: 1, reason: "second stall" },
      context,
    )).resolves.toEqual({ id: "request-id" });

    expect(mocks.transaction.billingChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestType: "ADDITIONAL_STALL", requestedQuantity: 1 }),
    });
  });

  it("cannot route a PAYG version through the fixed-price invoice workflow", async () => {
    mocks.transaction.subscription.findUnique.mockResolvedValue({ id: "subscription-id" });
    mocks.transaction.planVersion.findUnique.mockResolvedValue(paygVersion);

    await expect(new BillingWorkflowService().createPlanInvoice({
      organizationId: "organization-id",
      planVersionId: "payg-v1",
      billingInterval: "MONTHLY",
      dueAt: new Date("2026-09-07T00:00:00.000Z"),
    }, context)).rejects.toMatchObject({ code: "PLAN_VERSION_NOT_AVAILABLE" });

    expect(mocks.transaction.invoice.create).not.toHaveBeenCalled();
  });
});
