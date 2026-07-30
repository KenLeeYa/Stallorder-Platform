import "server-only";

import { Prisma, type MerchantApplicationRiskLevel, type MerchantApplicationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MerchantApplicationAdminCommand } from "@/lib/merchant-application-contract";
import { assertMerchantApplicationTransition } from "./application-state";

type ReviewContext = { actorProfileId: string; requestId: string; ipHash: string };

export class MerchantApplicationReviewError extends Error {
  constructor(readonly code:
    | "APPLICATION_NOT_FOUND"
    | "APPLICATION_STATE_CONFLICT"
    | "REVIEWER_NOT_AVAILABLE") {
    super(code);
  }
}

export type MerchantApplicationListFilter = {
  status?: MerchantApplicationStatus;
  riskLevel?: MerchantApplicationRiskLevel;
  duplicateReason?: "DUPLICATE_EMAIL" | "DUPLICATE_PHONE" | "DUPLICATE_SLUG";
  reviewer?: "ASSIGNED" | "UNASSIGNED";
  submitted?: "TODAY" | "OLDER_THAN_2_DAYS";
};

export async function listMerchantApplications(filters: MerchantApplicationListFilter = {}) {
  const where: Prisma.MerchantApplicationWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.riskLevel) where.riskLevel = filters.riskLevel;
  if (filters.reviewer) where.assignedReviewerProfileId = filters.reviewer === "ASSIGNED" ? { not: null } : null;
  if (filters.duplicateReason) where.riskReasonsJson = { array_contains: [filters.duplicateReason] };
  if (filters.submitted === "TODAY") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    where.submittedAt = { gte: today };
  } else if (filters.submitted === "OLDER_THAN_2_DAYS") {
    where.submittedAt = { lt: new Date(Date.now() - 2 * 86_400_000) };
    where.status = filters.status ?? { in: ["PENDING_REVIEW", "NEEDS_INFO"] };
  }

  return prisma.merchantApplication.findMany({
    where,
    orderBy: [{ riskLevel: "desc" }, { submittedAt: "asc" }, { createdAt: "asc" }],
    include: {
      assignedReviewer: { select: { id: true, displayName: true } },
    },
    take: 200,
  });
}

export async function getMerchantApplicationForAdmin(applicationId: string) {
  return prisma.merchantApplication.findUnique({
    where: { id: applicationId },
    include: {
      applicant: {
        select: {
          id: true,
          displayName: true,
          email: true,
          isActive: true,
          authUserId: true,
          authIdentities: {
            where: { revokedAt: null },
            orderBy: { createdAt: "asc" },
            select: { provider: true },
          },
          merchantApplications: {
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              applicationNumber: true,
              merchantName: true,
              status: true,
              createdAt: true,
            },
          },
        },
      },
      assignedReviewer: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
      approvedOrganization: {
        select: {
          id: true,
          businessName: true,
          status: true,
          subscription: { select: { id: true, status: true, trialEndsAt: true, planVersion: { select: { displayName: true, version: true } } } },
          merchantSetupProgress: { select: { testOrderCompleted: true, goLiveCompleted: true } },
        },
      },
    },
  });
}

export async function listPlatformReviewers() {
  return prisma.profile.findMany({
    where: { platformRole: "PLATFORM_ADMIN", isActive: true },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, email: true },
  });
}

export async function applyMerchantApplicationReviewAction(
  applicationId: string,
  command: Exclude<MerchantApplicationAdminCommand, { action: "APPROVE" }>,
  context: ReviewContext,
) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id from public.merchant_applications
      where id = ${applicationId}::uuid
      for update
    `;
    const application = await transaction.merchantApplication.findUnique({ where: { id: applicationId } });
    if (!application) throw new MerchantApplicationReviewError("APPLICATION_NOT_FOUND");

    const now = new Date();
    let nextStatus = application.status;
    let notification: { type: string; title: string; message: string } | null = null;
    let data: Prisma.MerchantApplicationUpdateInput = {};

    switch (command.action) {
      case "ASSIGN_REVIEWER": {
        const reviewer = await transaction.profile.findFirst({
          where: { id: command.reviewerProfileId, platformRole: "PLATFORM_ADMIN", isActive: true },
          select: { id: true },
        });
        if (!reviewer) throw new MerchantApplicationReviewError("REVIEWER_NOT_AVAILABLE");
        data = { assignedReviewer: { connect: { id: reviewer.id } } };
        break;
      }
      case "ADD_INTERNAL_NOTE":
        data = { internalReviewNote: command.internalReviewNote };
        break;
      case "REQUEST_INFO":
        assertAdminTransition(application.status, "NEEDS_INFO");
        nextStatus = "NEEDS_INFO";
        data = {
          status: nextStatus,
          publicReviewNote: command.publicReviewNote,
          internalReviewNote: command.internalReviewNote ?? application.internalReviewNote,
          reviewedAt: now,
          reviewedBy: { connect: { id: context.actorProfileId } },
        };
        notification = {
          type: "MERCHANT_APPLICATION_NEEDS_INFO",
          title: "商家申請需要補充資料",
          message: command.publicReviewNote,
        };
        break;
      case "REJECT":
        assertAdminTransition(application.status, "REJECTED");
        nextStatus = "REJECTED";
        data = {
          status: nextStatus,
          publicReviewNote: command.publicReviewNote,
          internalReviewNote: command.internalReviewNote ?? application.internalReviewNote,
          reapplicationAllowed: command.reapplicationAllowed,
          reviewedAt: now,
          rejectedAt: now,
          reviewedBy: { connect: { id: context.actorProfileId } },
        };
        notification = {
          type: "MERCHANT_APPLICATION_REJECTED",
          title: "商家申請審核結果",
          message: command.publicReviewNote,
        };
        break;
      case "ALLOW_REAPPLICATION":
        if (application.status !== "REJECTED") throw new MerchantApplicationReviewError("APPLICATION_STATE_CONFLICT");
        data = { reapplicationAllowed: true };
        break;
      case "MARK_RISK":
        data = {
          riskLevel: command.riskLevel,
          internalReviewNote: appendInternalNote(application.internalReviewNote, command.reason),
        };
        break;
      case "BLOCK_SOURCE":
        data = {
          riskLevel: "BLOCKED",
          riskReasonsJson: mergeRiskReasons(application.riskReasonsJson, "SECURITY_EVENT_MATCH"),
          internalReviewNote: appendInternalNote(application.internalReviewNote, `封鎖來源：${command.reason}`),
        };
        break;
      case "WITHDRAW":
        assertAdminTransition(application.status, "WITHDRAWN");
        nextStatus = "WITHDRAWN";
        data = {
          status: nextStatus,
          withdrawnAt: now,
          reviewedAt: now,
          reviewedBy: { connect: { id: context.actorProfileId } },
          internalReviewNote: command.internalReviewNote ?? application.internalReviewNote,
        };
        notification = {
          type: "MERCHANT_APPLICATION_WITHDRAWN",
          title: "商家申請已結束",
          message: "平台已結束本次商家申請。",
        };
        break;
    }

    const updated = await transaction.merchantApplication.update({ where: { id: application.id }, data });
    if (notification) {
      await transaction.merchantApplicationNotification.create({
        data: { applicationId: application.id, profileId: application.applicantProfileId, ...notification },
      });
    }
    await transaction.auditLog.create({
      data: {
        actorProfileId: context.actorProfileId,
        action: `MERCHANT_APPLICATION_${command.action}`,
        entityType: "MERCHANT_APPLICATION",
        entityId: application.id,
        outcome: "SUCCESS",
        requestId: context.requestId,
        ipHash: context.ipHash,
        beforeJson: { status: application.status, riskLevel: application.riskLevel },
        afterJson: { status: updated.status, riskLevel: updated.riskLevel },
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function assertAdminTransition(current: MerchantApplicationStatus, next: MerchantApplicationStatus) {
  try {
    assertMerchantApplicationTransition(current, next, "PLATFORM_ADMIN");
  } catch {
    throw new MerchantApplicationReviewError("APPLICATION_STATE_CONFLICT");
  }
}

function mergeRiskReasons(current: Prisma.JsonValue | null, reason: string) {
  const values = Array.isArray(current) ? current.filter((value): value is string => typeof value === "string") : [];
  return [...new Set([...values, reason])];
}

function appendInternalNote(current: string | null, note: string) {
  return [current, note].filter(Boolean).join("\n").slice(0, 2000);
}
