import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { newStallOrderingSettings } from "@/lib/new-stall-ordering-defaults";
import { prisma } from "@/lib/prisma";

export type MerchantApprovalErrorCode =
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_STATE_CONFLICT"
  | "APPLICANT_NOT_ELIGIBLE"
  | "APPLICANT_ALREADY_ONBOARDED"
  | "APPLICATION_INCOMPLETE"
  | "APPLICATION_RISK_BLOCKED"
  | "SLUG_UNAVAILABLE"
  | "TRIAL_PLAN_NOT_AVAILABLE"
  | "PROVISIONING_CONFLICT";

export class MerchantApprovalError extends Error {
  constructor(readonly code: MerchantApprovalErrorCode) {
    super(code);
  }
}

type ApprovalAuditContext = {
  actorProfileId: string;
  requestId: string;
  ipHash: string;
  internalReviewNote?: string | null;
};

export async function approveMerchantApplication(
  applicationId: string,
  context: ApprovalAuditContext,
) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        select id
        from public.merchant_applications
        where id = ${applicationId}::uuid
        for update
      `;

      const application = await transaction.merchantApplication.findUnique({
        where: { id: applicationId },
        include: {
          applicant: {
            include: {
              authIdentities: {
                where: { revokedAt: null },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
      if (!application) throw new MerchantApprovalError("APPLICATION_NOT_FOUND");
      if (application.status === "APPROVED" && application.approvedOrganizationId) {
        return {
          applicationId: application.id,
          organizationId: application.approvedOrganizationId,
          idempotent: true,
        };
      }
      if (application.status !== "PENDING_REVIEW") {
        throw new MerchantApprovalError("APPLICATION_STATE_CONFLICT");
      }
      if (application.riskLevel === "BLOCKED") {
        throw new MerchantApprovalError("APPLICATION_RISK_BLOCKED");
      }
      if (
        !application.applicant.isActive
        || (!application.applicant.authUserId && application.applicant.authIdentities.length === 0)
      ) {
        throw new MerchantApprovalError("APPLICANT_NOT_ELIGIBLE");
      }

      const required = [
        application.merchantName,
        application.contactName,
        application.phone,
        application.businessPhone,
        application.businessAddress,
        application.city,
        application.stallName,
        application.stallLocation,
        application.requestedSlug,
      ];
      if (
        required.some((value) => !value?.trim())
        || !application.businessType
        || !application.preferredContactMethod
        || !application.termsAccepted
        || !application.privacyAccepted
        || !application.dataProcessingAccepted
        || !application.informationConfirmed
      ) {
        throw new MerchantApprovalError("APPLICATION_INCOMPLETE");
      }

      const [organizationMemberships, stallMemberships, slugConflict, emailConflict] = await Promise.all([
        transaction.organizationMembership.count({
          where: { profileId: application.applicantProfileId, isActive: true },
        }),
        transaction.stallMembership.count({
          where: { profileId: application.applicantProfileId, isActive: true },
        }),
        transaction.stall.count({ where: { slug: application.requestedSlug as string } }),
        transaction.organization.count({ where: { email: application.applicantEmail } }),
      ]);
      if (organizationMemberships > 0 || stallMemberships > 0 || emailConflict > 0) {
        throw new MerchantApprovalError("APPLICANT_ALREADY_ONBOARDED");
      }
      if (slugConflict > 0) throw new MerchantApprovalError("SLUG_UNAVAILABLE");

      const now = new Date();
      const trialVersion = await transaction.planVersion.findFirst({
        where: {
          plan: { code: "TRIAL", isActive: true },
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
        orderBy: { version: "desc" },
        include: { plan: true },
      });
      if (!trialVersion) throw new MerchantApprovalError("TRIAL_PLAN_NOT_AVAILABLE");

      const trialDays = trialVersion.trialDays ?? 14;
      const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);
      const billingPeriodStart = utcDate(now);
      const billingPeriodEnd = utcDate(trialEndsAt);
      const requestedSlug = application.requestedSlug as string;
      const organization = await transaction.organization.create({
        data: {
          name: application.merchantName as string,
          businessName: application.merchantName as string,
          slug: `${requestedSlug}-${application.id.slice(0, 8)}`,
          status: "TRIALING",
          email: application.applicantEmail,
          phone: application.businessPhone as string,
        },
      });

      const subscription = await transaction.subscription.create({
        data: {
          organizationId: organization.id,
          planId: trialVersion.planId,
          planVersionId: trialVersion.id,
          status: "TRIALING",
          billingInterval: "TRIAL",
          billingPeriodStart,
          billingPeriodEnd,
          trialStartedAt: now,
          trialEndsAt,
          paymentDueAt: trialEndsAt,
        },
      });
      await transaction.organizationMembership.create({
        data: {
          organizationId: organization.id,
          profileId: application.applicantProfileId,
          role: "ORGANIZATION_OWNER",
          allStalls: true,
          isPrimaryOwner: true,
        },
      });

      const stall = await transaction.stall.create({
        data: {
          organizationId: organization.id,
          name: application.stallName as string,
          slug: requestedSlug,
          code: requestedSlug.toUpperCase().slice(0, 50),
          description: application.merchantDescription ?? "",
          address: application.businessAddress as string,
          phone: application.businessPhone as string,
          location: application.stallLocation as string,
          isActive: true,
          businessStatus: "CLOSED",
          orderingState: "CLOSED",
          orderingEnabled: false,
          orderingSettings: { create: newStallOrderingSettings(organization.id) },
        },
      });
      const qrCode = await transaction.qrCode.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          token: randomBytes(32).toString("base64url"),
          label: "主要點餐 QR v1",
          state: "PAUSED",
        },
      });

      const category = await transaction.productCategory.create({
        data: { organizationId: organization.id, name: "測試分類", sortOrder: 1 },
      });
      const sampleProduct = await transaction.product.create({
        data: {
          organizationId: organization.id,
          categoryId: category.id,
          name: "設定測試商品（上線前請修改）",
          description: "此商品僅供開店測試流程使用。",
          defaultPrice: 1,
          sortOrder: 1,
        },
      });
      await transaction.stallProduct.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          productId: sampleProduct.id,
          sortOrder: 1,
        },
      });
      await transaction.paymentOption.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          code: "CASH",
          name: "現金",
          kind: "CASH",
          isEnabled: true,
        },
      });

      await transaction.merchantSetupProgress.create({
        data: {
          applicationId: application.id,
          organizationId: organization.id,
          stallId: stall.id,
          qrCodeId: qrCode.id,
          currentStep: 1,
        },
      });
      await transaction.merchantApplication.update({
        where: { id: application.id },
        data: {
          status: "APPROVED",
          approvedAt: now,
          reviewedAt: now,
          reviewedByProfileId: context.actorProfileId,
          approvedOrganizationId: organization.id,
          internalReviewNote: context.internalReviewNote ?? application.internalReviewNote,
        },
      });
      await transaction.merchantApplicationNotification.create({
        data: {
          applicationId: application.id,
          profileId: application.applicantProfileId,
          type: "MERCHANT_APPLICATION_APPROVED",
          title: "商家申請已核准",
          message: "Trial 工作區已建立。完成設定與測試訂單前，QR 點餐仍維持暫停。",
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          actorProfileId: context.actorProfileId,
          action: "MERCHANT_APPLICATION_APPROVED",
          entityType: "MERCHANT_APPLICATION",
          entityId: application.id,
          outcome: "SUCCESS",
          requestId: context.requestId,
          ipHash: context.ipHash,
          beforeJson: { status: application.status },
          afterJson: {
            status: "APPROVED",
            organizationStatus: "TRIALING",
            subscriptionStatus: "TRIALING",
            stallOrderingState: "CLOSED",
            qrCodeState: "PAUSED",
          },
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          actorProfileId: context.actorProfileId,
          action: "MERCHANT_TRIAL_PROVISIONED",
          entityType: "SUBSCRIPTION",
          entityId: subscription.id,
          outcome: "SUCCESS",
          requestId: context.requestId,
          ipHash: context.ipHash,
          afterJson: { planVersionId: trialVersion.id, trialEndsAt: trialEndsAt.toISOString() },
        },
      });

      return { applicationId: application.id, organizationId: organization.id, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof MerchantApprovalError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new MerchantApprovalError("PROVISIONING_CONFLICT");
    }
    throw error;
  }
}

function utcDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
