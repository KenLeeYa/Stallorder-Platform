import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MerchantSetupCommand } from "@/lib/merchant-setup-contract";
import { createStaffOrder } from "@/lib/staff-order-create";

type SetupContext = {
  actorProfileId: string;
  actorRoles: readonly UserRole[];
  requestId: string;
  ipHash: string;
};

type SetupStep = Extract<MerchantSetupCommand, { action: "COMPLETE_STEP" }>["step"];

export class MerchantSetupError extends Error {
  constructor(readonly code:
    | "SETUP_NOT_FOUND"
    | "SETUP_ALREADY_LIVE"
    | "SETUP_STEP_NOT_READY"
    | "SETUP_PREREQUISITES_INCOMPLETE"
    | "TEST_PRODUCT_NOT_AVAILABLE"
    | "TEST_ORDER_NOT_COMPLETED"
    | "SUBSCRIPTION_NOT_ACTIVE"
    | "QR_NOT_PAUSED"
    | "GO_LIVE_STATE_CONFLICT") {
    super(code);
  }
}

export async function getMerchantSetupOverview(organizationId: string) {
  const progress = await prisma.merchantSetupProgress.findUnique({
    where: { organizationId },
    include: {
      application: { select: { applicationNumber: true, merchantName: true } },
      organization: {
        select: {
          id: true,
          businessName: true,
          email: true,
          phone: true,
          status: true,
          subscription: {
            select: {
              id: true,
              status: true,
              trialEndsAt: true,
              planVersion: { select: { displayName: true, version: true } },
            },
          },
        },
      },
      stall: {
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          location: true,
          businessStatus: true,
          orderingState: true,
          orderingEnabled: true,
        },
      },
      qrCode: { select: { id: true, token: true, tokenVersion: true, state: true } },
      testOrder: { select: { id: true, orderNo: true, status: true, isTest: true, createdAt: true } },
    },
  });
  if (!progress) return null;
  const [activeProducts, paymentOptions, teamMembers] = await Promise.all([
    prisma.stallProduct.count({
      where: {
        organizationId,
        stallId: progress.stallId,
        isEnabled: true,
        product: { isActive: true },
      },
    }),
    prisma.paymentOption.count({
      where: { organizationId, stallId: progress.stallId, isEnabled: true },
    }),
    prisma.organizationMembership.count({ where: { organizationId, isActive: true } }),
  ]);
  return { ...progress, activeProducts, paymentOptions, teamMembers };
}

export async function getPendingMerchantSetupPath(profileId: string) {
  const setup = await prisma.merchantSetupProgress.findFirst({
    where: {
      goLiveCompleted: false,
      organization: {
        memberships: {
          some: { profileId, isActive: true, role: "ORGANIZATION_OWNER" },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return setup ? `/merchant/setup?organizationId=${setup.organizationId}` : null;
}

export async function completeMerchantSetupStep(
  organizationId: string,
  step: SetupStep,
  context: SetupContext,
) {
  return prisma.$transaction(async (transaction) => {
    const progress = await transaction.merchantSetupProgress.findUnique({
      where: { organizationId },
      include: { organization: true, stall: true, qrCode: true },
    });
    if (!progress) throw new MerchantSetupError("SETUP_NOT_FOUND");
    if (progress.goLiveCompleted) throw new MerchantSetupError("SETUP_ALREADY_LIVE");

    await assertStepReady(transaction, progress, step);
    const data = stepCompletionData(step);
    const updated = await transaction.merchantSetupProgress.update({
      where: { id: progress.id },
      data,
    });
    await transaction.auditLog.create({
      data: {
        organizationId,
        stallId: progress.stallId,
        actorProfileId: context.actorProfileId,
        action: "MERCHANT_SETUP_STEP_COMPLETED",
        entityType: "MERCHANT_SETUP_PROGRESS",
        entityId: progress.id,
        outcome: "SUCCESS",
        requestId: context.requestId,
        ipHash: context.ipHash,
        beforeJson: { currentStep: progress.currentStep },
        afterJson: { currentStep: updated.currentStep, step },
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createMerchantSetupTestOrder(
  organizationId: string,
  context: SetupContext,
) {
  const progress = await prisma.merchantSetupProgress.findUnique({
    where: { organizationId },
    include: { testOrder: { select: { id: true, orderNo: true, status: true, isTest: true } } },
  });
  if (!progress) throw new MerchantSetupError("SETUP_NOT_FOUND");
  if (progress.goLiveCompleted) throw new MerchantSetupError("SETUP_ALREADY_LIVE");
  if (!allPreparationStepsComplete(progress)) {
    throw new MerchantSetupError("SETUP_PREREQUISITES_INCOMPLETE");
  }
  if (progress.testOrder && !["CANCELLED", "EXPIRED", "COMPLETED"].includes(progress.testOrder.status)) {
    return { order: progress.testOrder, idempotent: true };
  }
  if (progress.testOrder?.status === "COMPLETED") {
    return { order: progress.testOrder, idempotent: true };
  }

  const [product, attemptCount] = await Promise.all([
    prisma.stallProduct.findFirst({
      where: {
        organizationId,
        stallId: progress.stallId,
        isEnabled: true,
        isSoldOut: false,
        product: { isActive: true },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { productId: true },
    }),
    prisma.order.count({
      where: { organizationId, stallId: progress.stallId, isTest: true, source: "MERCHANT_SETUP_TEST" },
    }),
  ]);
  if (!product) throw new MerchantSetupError("TEST_PRODUCT_NOT_AVAILABLE");

  const created = await createStaffOrder({
    organizationId,
    stallId: progress.stallId,
    actorProfileId: context.actorProfileId,
    actorRoles: context.actorRoles,
    creationMode: "SETUP_TEST",
    request: {
      idempotencyKey: deterministicSetupOrderUuid(`${progress.id}:${attemptCount + 1}`),
      fulfillmentType: "TAKEOUT",
      customerName: "開店流程測試",
      customerPhone: "",
      customerNote: "此為開店設定測試訂單，不計入營收與用量。",
      paymentTiming: "PAY_LATER",
      items: [{
        productId: product.productId,
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
    },
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.merchantSetupProgress.update({
      where: { id: progress.id },
      data: {
        testOrderId: created.order.id,
        testOrderCompleted: created.order.status === "COMPLETED",
        testOrderCompletedAt: created.order.status === "COMPLETED" ? new Date() : null,
        currentStep: Math.max(progress.currentStep, 7),
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId,
        stallId: progress.stallId,
        actorProfileId: context.actorProfileId,
        action: created.idempotent ? "MERCHANT_SETUP_TEST_ORDER_REUSED" : "MERCHANT_SETUP_TEST_ORDER_CREATED",
        entityType: "ORDER",
        entityId: created.order.id,
        outcome: "SUCCESS",
        requestId: context.requestId,
        ipHash: context.ipHash,
        afterJson: { isTest: true, status: created.order.status },
      },
    });
  });
  return created;
}

export async function activateMerchantGoLive(
  organizationId: string,
  context: SetupContext,
) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id from public.merchant_setup_progress
      where organization_id = ${organizationId}::uuid
      for update
    `;
    const progress = await transaction.merchantSetupProgress.findUnique({
      where: { organizationId },
      include: {
        organization: { select: { status: true, subscription: { select: { status: true } } } },
        stall: true,
        qrCode: true,
        testOrder: { select: { id: true, status: true, isTest: true, completedAt: true } },
        application: { select: { applicantProfileId: true } },
      },
    });
    if (!progress) throw new MerchantSetupError("SETUP_NOT_FOUND");
    if (
      progress.goLiveCompleted
      && progress.qrCode.state === "ACTIVE"
      && progress.stall.orderingState === "OPEN"
      && progress.stall.orderingEnabled
    ) return { progress, idempotent: true };
    if (!allPreparationStepsComplete(progress)) {
      throw new MerchantSetupError("SETUP_PREREQUISITES_INCOMPLETE");
    }
    if (!progress.testOrder?.isTest || progress.testOrder.status !== "COMPLETED") {
      throw new MerchantSetupError("TEST_ORDER_NOT_COMPLETED");
    }
    if (!progress.organization.subscription || !["TRIALING", "ACTIVE"].includes(progress.organization.subscription.status)) {
      throw new MerchantSetupError("SUBSCRIPTION_NOT_ACTIVE");
    }
    if (progress.qrCode.state !== "PAUSED") throw new MerchantSetupError("QR_NOT_PAUSED");
    if (progress.stall.orderingState !== "CLOSED" || progress.stall.orderingEnabled) {
      throw new MerchantSetupError("GO_LIVE_STATE_CONFLICT");
    }
    const [activeProducts, paymentOptions] = await Promise.all([
      transaction.stallProduct.count({
        where: {
          organizationId,
          stallId: progress.stallId,
          isEnabled: true,
          isSoldOut: false,
          product: { isActive: true, category: { isActive: true } },
        },
      }),
      transaction.paymentOption.count({
        where: { organizationId, stallId: progress.stallId, isEnabled: true },
      }),
    ]);
    if (activeProducts < 1 || paymentOptions < 1) {
      throw new MerchantSetupError("SETUP_PREREQUISITES_INCOMPLETE");
    }

    const now = new Date();
    await transaction.qrCode.update({ where: { id: progress.qrCodeId }, data: { state: "ACTIVE" } });
    await transaction.stall.update({
      where: { id: progress.stallId },
      data: { orderingState: "OPEN", businessStatus: "OPEN", orderingEnabled: true },
    });
    const completed = await transaction.merchantSetupProgress.update({
      where: { id: progress.id },
      data: {
        testOrderCompleted: true,
        testOrderCompletedAt: progress.testOrder.completedAt ?? now,
        completedByProfileId: context.actorProfileId,
        goLiveCompleted: true,
        goLiveCompletedAt: now,
        activatedByProfileId: context.actorProfileId,
        completedAt: now,
        currentStep: 8,
      },
    });
    await transaction.merchantApplicationNotification.create({
      data: {
        applicationId: progress.applicationId,
        profileId: progress.application.applicantProfileId,
        type: "MERCHANT_GO_LIVE",
        title: "QR 點餐已正式開放",
        message: "開店設定與測試訂單已完成，目前可接收正式顧客訂單。",
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId,
        stallId: progress.stallId,
        actorProfileId: context.actorProfileId,
        action: "MERCHANT_GO_LIVE",
        entityType: "MERCHANT_SETUP_PROGRESS",
        entityId: progress.id,
        outcome: "SUCCESS",
        requestId: context.requestId,
        ipHash: context.ipHash,
        beforeJson: { qrCodeState: progress.qrCode.state, stallOrderingState: progress.stall.orderingState },
        afterJson: { qrCodeState: "ACTIVE", stallOrderingState: "OPEN", orderingEnabled: true },
      },
    });
    return { progress: completed, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function assertStepReady(
  transaction: Prisma.TransactionClient,
  progress: {
    organizationId: string;
    stallId: string;
    organization: { businessName: string; email: string; phone: string };
    stall: { name: string; address: string; location: string };
    qrCode: { state: string; token: string };
  },
  step: SetupStep,
) {
  if (step === "MERCHANT_PROFILE" && (!progress.organization.businessName || !progress.organization.email || !progress.organization.phone)) {
    throw new MerchantSetupError("SETUP_STEP_NOT_READY");
  }
  if (step === "STALL_PROFILE" && (!progress.stall.name || !progress.stall.address || !progress.stall.location)) {
    throw new MerchantSetupError("SETUP_STEP_NOT_READY");
  }
  if (step === "CATALOG") {
    const products = await transaction.stallProduct.count({
      where: { organizationId: progress.organizationId, stallId: progress.stallId, isEnabled: true, product: { isActive: true } },
    });
    if (products < 1) throw new MerchantSetupError("SETUP_STEP_NOT_READY");
  }
  if (step === "PAYMENT_OPTIONS") {
    const options = await transaction.paymentOption.count({
      where: { organizationId: progress.organizationId, stallId: progress.stallId, isEnabled: true },
    });
    if (options < 1) throw new MerchantSetupError("SETUP_STEP_NOT_READY");
  }
  if (step === "QR_PREVIEW" && (progress.qrCode.state !== "PAUSED" || !progress.qrCode.token)) {
    throw new MerchantSetupError("SETUP_STEP_NOT_READY");
  }
}

function stepCompletionData(step: SetupStep): Prisma.MerchantSetupProgressUpdateInput {
  const index = ["MERCHANT_PROFILE", "STALL_PROFILE", "CATALOG", "PAYMENT_OPTIONS", "TEAM", "QR_PREVIEW"].indexOf(step) + 1;
  const fields: Record<SetupStep, keyof Prisma.MerchantSetupProgressUpdateInput> = {
    MERCHANT_PROFILE: "merchantProfileCompleted",
    STALL_PROFILE: "stallProfileCompleted",
    CATALOG: "catalogCompleted",
    PAYMENT_OPTIONS: "paymentOptionsCompleted",
    TEAM: "teamSetupCompleted",
    QR_PREVIEW: "qrPreviewCompleted",
  };
  return { [fields[step]]: true, currentStep: Math.min(7, index + 1) };
}

export function allPreparationStepsComplete(progress: {
  merchantProfileCompleted: boolean;
  stallProfileCompleted: boolean;
  catalogCompleted: boolean;
  paymentOptionsCompleted: boolean;
  teamSetupCompleted: boolean;
  qrPreviewCompleted: boolean;
}) {
  return progress.merchantProfileCompleted
    && progress.stallProfileCompleted
    && progress.catalogCompleted
    && progress.paymentOptionsCompleted
    && progress.teamSetupCompleted
    && progress.qrPreviewCompleted;
}

export function deterministicSetupOrderUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
