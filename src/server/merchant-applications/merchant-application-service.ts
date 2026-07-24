import "server-only";

import { Prisma, type MerchantApplicationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";
import type { MerchantApplicationFields } from "@/lib/merchant-application-contract";
import {
  hashApplicationIdentifier,
  normalizeApplicationPhone,
  normalizeRegistrationNumber,
} from "./application-identifiers";
import { classifyMerchantApplicationRisk, type MerchantApplicationRiskReason } from "./application-risk";
import {
  assertMerchantApplicationTransition,
  canStartMerchantReapplication,
} from "./application-state";

export const merchantApplicationPublicSelect = {
  id: true,
  applicationNumber: true,
  applicantEmail: true,
  applicantDisplayName: true,
  merchantName: true,
  businessType: true,
  businessRegistrationNumber: true,
  contactName: true,
  phone: true,
  businessPhone: true,
  lineId: true,
  preferredContactMethod: true,
  businessAddress: true,
  city: true,
  merchantDescription: true,
  stallName: true,
  stallLocation: true,
  requestedSlug: true,
  estimatedDailyOrders: true,
  expectedStartDate: true,
  needsMultipleStaff: true,
  needsKitchenView: true,
  requestedPlanCode: true,
  status: true,
  publicReviewNote: true,
  currentStep: true,
  submittedAt: true,
  reviewedAt: true,
  approvedAt: true,
  approvedOrganizationId: true,
  rejectedAt: true,
  withdrawnAt: true,
  expiresAt: true,
  reapplicationAllowed: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MerchantApplicationSelect;

type ApplicationIdentity = {
  profileId: string;
  authUserId: string;
  email: string;
  displayName: string;
  sessionId: string;
};

type AuditContext = { requestId: string; ipHash: string };

type WritableApplicationData = Partial<Pick<Prisma.MerchantApplicationUncheckedCreateInput,
  | "phone"
  | "phoneHash"
  | "businessRegistrationNumber"
  | "businessRegistrationNumberHash"
  | "expectedStartDate"
  | "lineId"
  | "preferredContactMethod"
  | "merchantName"
  | "businessType"
  | "contactName"
  | "businessPhone"
  | "businessAddress"
  | "city"
  | "merchantDescription"
  | "stallName"
  | "stallLocation"
  | "requestedSlug"
  | "estimatedDailyOrders"
  | "needsMultipleStaff"
  | "needsKitchenView"
  | "requestedPlanCode"
  | "termsAccepted"
  | "privacyAccepted"
  | "dataProcessingAccepted"
  | "informationConfirmed"
>>;

export type MerchantApplicationErrorCode =
  | "PROFILE_NOT_GOOGLE_LINKED"
  | "PROFILE_ALREADY_ONBOARDED"
  | "INVITATION_PENDING"
  | "APPLICATION_PENDING"
  | "APPLICATION_NOT_EDITABLE"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_SOURCE_BLOCKED"
  | "REAPPLICATION_NOT_ALLOWED"
  | "PLAN_NOT_AVAILABLE"
  | "MERCHANT_APPLICATION_TRANSITION_INVALID";

export class MerchantApplicationError extends Error {
  constructor(readonly code: MerchantApplicationErrorCode) {
    super(code);
  }
}

export async function getApplicantApplication(profileId: string) {
  return prisma.merchantApplication.findFirst({
    where: { applicantProfileId: profileId },
    orderBy: { createdAt: "desc" },
    select: merchantApplicationPublicSelect,
  });
}

export async function getApplicantApplicationDestination(profileId: string) {
  const application = await prisma.merchantApplication.findFirst({
    where: { applicantProfileId: profileId },
    orderBy: { createdAt: "desc" },
    select: { status: true, approvedOrganizationId: true },
  });
  if (!application) return "/onboarding";
  if (application.status === "NEEDS_INFO") return "/onboarding/edit";
  if (["SUBMITTED", "PENDING_REVIEW"].includes(application.status)) return "/onboarding/status";
  if (application.status === "APPROVED" && application.approvedOrganizationId) {
    return `/merchant/setup?organizationId=${application.approvedOrganizationId}`;
  }
  return "/onboarding";
}

export async function saveMerchantApplicationDraft(input: {
  identity: ApplicationIdentity;
  currentStep: number;
  data: Partial<MerchantApplicationFields>;
  audit: AuditContext;
}) {
  return prisma.$transaction(async (transaction) => {
    const profile = await requireApplicantEligibility(transaction, input.identity);
    const existing = await findActiveApplication(transaction, profile.id);
    if (existing && !["DRAFT", "NEEDS_INFO"].includes(existing.status)) {
      throw new MerchantApplicationError("APPLICATION_PENDING");
    }
    const reapplicationSource = existing
      ? null
      : await findReapplicationSource(transaction, profile.id);

    const data = applicationData(input.data);
    const application = existing
      ? await transaction.merchantApplication.update({
          where: { id: existing.id },
          data: { ...data, currentStep: Math.max(existing.currentStep, input.currentStep) },
          select: merchantApplicationPublicSelect,
        })
      : await transaction.merchantApplication.create({
          data: {
            applicantProfileId: profile.id,
            applicantEmail: profile.email,
            applicantDisplayName: profile.displayName,
            currentStep: input.currentStep,
            submissionDeviceHash: hashToken(`merchant-application:${input.identity.sessionId}`),
            ...copyApplicationDataForReapplication(reapplicationSource),
            ...data,
          },
          select: merchantApplicationPublicSelect,
        });

    await transaction.auditLog.create({
      data: {
        action: existing
          ? "MERCHANT_APPLICATION_DRAFT_UPDATED"
          : reapplicationSource
            ? "MERCHANT_APPLICATION_REAPPLICATION_STARTED"
            : "MERCHANT_APPLICATION_DRAFTED",
        entityType: "MERCHANT_APPLICATION",
        entityId: application.id,
        actorProfileId: profile.id,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        beforeJson: reapplicationSource
          ? { applicationId: reapplicationSource.id, status: reapplicationSource.status }
          : undefined,
        afterJson: { status: application.status, currentStep: application.currentStep },
      },
    });
    return application;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function submitMerchantApplication(input: {
  identity: ApplicationIdentity;
  data: MerchantApplicationFields;
  audit: AuditContext;
}) {
  return prisma.$transaction(async (transaction) => {
    const profile = await requireApplicantEligibility(transaction, input.identity);
    const sourceBlocked = await transaction.merchantApplication.count({
      where: {
        riskLevel: "BLOCKED",
        OR: [
          { submissionDeviceHash: hashToken(`merchant-application:${input.identity.sessionId}`) },
          { submissionIpHash: input.audit.ipHash },
        ],
      },
    });
    if (sourceBlocked > 0) throw new MerchantApplicationError("APPLICATION_SOURCE_BLOCKED");
    let application = await findActiveApplication(transaction, profile.id);
    if (application && !["DRAFT", "NEEDS_INFO"].includes(application.status)) {
      throw new MerchantApplicationError("APPLICATION_PENDING");
    }
    if (!application) {
      await findReapplicationSource(transaction, profile.id);
      application = await transaction.merchantApplication.create({
        data: {
          applicantProfileId: profile.id,
          applicantEmail: profile.email,
          applicantDisplayName: profile.displayName,
          currentStep: 4,
          submissionDeviceHash: hashToken(`merchant-application:${input.identity.sessionId}`),
          ...applicationData(input.data),
        },
      });
    }

    const plan = await transaction.plan.findFirst({
      where: { code: input.data.requestedPlanCode, isActive: true },
      select: { id: true },
    });
    if (!plan) throw new MerchantApplicationError("PLAN_NOT_AVAILABLE");

    const duplicateRisk = await findDuplicateRiskReasons(transaction, {
      applicationId: application.id,
      profileId: profile.id,
      email: profile.email,
      phoneHash: hashApplicationIdentifier("phone", normalizeApplicationPhone(input.data.phone)),
      registrationHash: normalizeRegistrationNumber(input.data.businessRegistrationNumber)
        ? hashApplicationIdentifier(
            "registration",
            normalizeRegistrationNumber(input.data.businessRegistrationNumber) as string,
          )
        : null,
      requestedSlug: input.data.requestedSlug,
    });
    const risk = classifyMerchantApplicationRisk(duplicateRisk);
    const now = new Date();
    assertTransition(application.status, "SUBMITTED", "APPLICANT");

    const submitted = await transaction.merchantApplication.update({
      where: { id: application.id },
      data: {
        ...applicationData(input.data),
        status: "SUBMITTED",
        currentStep: 4,
        riskLevel: risk.level,
        riskReasonsJson: risk.reasons,
        submittedAt: now,
        consentedAt: now,
        submissionIpHash: input.audit.ipHash,
        submissionDeviceHash: hashToken(`merchant-application:${input.identity.sessionId}`),
        publicReviewNote: null,
        reviewedAt: null,
        reviewedByProfileId: null,
      },
    });
    assertTransition(submitted.status, "PENDING_REVIEW", "PLATFORM_ADMIN");
    const queued = await transaction.merchantApplication.update({
      where: { id: submitted.id },
      data: { status: "PENDING_REVIEW" },
      select: merchantApplicationPublicSelect,
    });

    await transaction.merchantApplicationNotification.create({
      data: {
        applicationId: queued.id,
        profileId: profile.id,
        type: "MERCHANT_APPLICATION_SUBMITTED",
        title: "商家申請已送出",
        message: "申請已進入人工審核，狀態更新時會顯示於申請頁面。",
      },
    });
    await transaction.auditLog.create({
      data: {
        action: "MERCHANT_APPLICATION_SUBMITTED",
        entityType: "MERCHANT_APPLICATION",
        entityId: queued.id,
        actorProfileId: profile.id,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        beforeJson: { status: application.status },
        afterJson: { status: queued.status, riskLevel: risk.level },
      },
    });
    return queued;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function withdrawMerchantApplication(input: {
  identity: ApplicationIdentity;
  applicationId: string;
  audit: AuditContext;
}) {
  return prisma.$transaction(async (transaction) => {
    const application = await transaction.merchantApplication.findFirst({
      where: { id: input.applicationId, applicantProfileId: input.identity.profileId },
    });
    if (!application) throw new MerchantApplicationError("APPLICATION_NOT_FOUND");
    assertTransition(application.status, "WITHDRAWN", "APPLICANT");
    const withdrawn = await transaction.merchantApplication.update({
      where: { id: application.id },
      data: { status: "WITHDRAWN", withdrawnAt: new Date() },
      select: merchantApplicationPublicSelect,
    });
    await transaction.auditLog.create({
      data: {
        action: "MERCHANT_APPLICATION_WITHDRAWN",
        entityType: "MERCHANT_APPLICATION",
        entityId: application.id,
        actorProfileId: input.identity.profileId,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        beforeJson: { status: application.status },
        afterJson: { status: withdrawn.status },
      },
    });
    return withdrawn;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function requireApplicantEligibility(transaction: Prisma.TransactionClient, identity: ApplicationIdentity) {
  const profile = await transaction.profile.findUnique({ where: { id: identity.profileId } });
  if (!profile?.isActive || !profile.authUserId || profile.authUserId !== identity.authUserId) {
    throw new MerchantApplicationError("PROFILE_NOT_GOOGLE_LINKED");
  }
  const [organizationAccess, stallAccess, invitation] = await Promise.all([
    transaction.organizationMembership.count({ where: { profileId: profile.id, isActive: true } }),
    transaction.stallMembership.count({ where: { profileId: profile.id, isActive: true } }),
    transaction.organizationInvitation.count({
      where: { email: profile.email, status: "PENDING", expiresAt: { gt: new Date() } },
    }),
  ]);
  if (organizationAccess > 0 || stallAccess > 0) {
    throw new MerchantApplicationError("PROFILE_ALREADY_ONBOARDED");
  }
  if (invitation > 0) throw new MerchantApplicationError("INVITATION_PENDING");
  return profile;
}

async function findActiveApplication(transaction: Prisma.TransactionClient, profileId: string) {
  return transaction.merchantApplication.findFirst({
    where: {
      applicantProfileId: profileId,
      status: { in: ["DRAFT", "SUBMITTED", "PENDING_REVIEW", "NEEDS_INFO"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findReapplicationSource(transaction: Prisma.TransactionClient, profileId: string) {
  const latestApplication = await transaction.merchantApplication.findFirst({
    where: { applicantProfileId: profileId },
    orderBy: { createdAt: "desc" },
  });
  if (latestApplication?.status === "REJECTED" && !latestApplication.reapplicationAllowed) {
    throw new MerchantApplicationError("REAPPLICATION_NOT_ALLOWED");
  }
  if (!latestApplication || !canStartMerchantReapplication(
    latestApplication.status,
    latestApplication.reapplicationAllowed,
  )) {
    return null;
  }
  return latestApplication;
}

function copyApplicationDataForReapplication(
  application: Awaited<ReturnType<typeof findReapplicationSource>>,
): WritableApplicationData {
  if (!application) return {};
  return {
    phone: application.phone,
    phoneHash: application.phoneHash,
    businessRegistrationNumber: application.businessRegistrationNumber,
    businessRegistrationNumberHash: application.businessRegistrationNumberHash,
    expectedStartDate: application.expectedStartDate,
    lineId: application.lineId,
    preferredContactMethod: application.preferredContactMethod,
    merchantName: application.merchantName,
    businessType: application.businessType,
    contactName: application.contactName,
    businessPhone: application.businessPhone,
    businessAddress: application.businessAddress,
    city: application.city,
    merchantDescription: application.merchantDescription,
    stallName: application.stallName,
    stallLocation: application.stallLocation,
    requestedSlug: application.requestedSlug,
    estimatedDailyOrders: application.estimatedDailyOrders,
    needsMultipleStaff: application.needsMultipleStaff,
    needsKitchenView: application.needsKitchenView,
    requestedPlanCode: application.requestedPlanCode,
  };
}

async function findDuplicateRiskReasons(
  transaction: Prisma.TransactionClient,
  input: {
    applicationId: string;
    profileId: string;
    email: string;
    phoneHash: string;
    registrationHash: string | null;
    requestedSlug: string;
  },
) {
  const visibleStatuses: MerchantApplicationStatus[] = [
    "SUBMITTED", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED",
  ];
  const [email, phone, registration, slugApplication, stallSlug, priorRejection] = await Promise.all([
    transaction.merchantApplication.count({
      where: {
        id: { not: input.applicationId }, applicantEmail: input.email, status: { in: visibleStatuses },
      },
    }),
    transaction.merchantApplication.count({
      where: {
        id: { not: input.applicationId }, phoneHash: input.phoneHash, status: { in: visibleStatuses },
      },
    }),
    input.registrationHash
      ? transaction.merchantApplication.count({
          where: {
            id: { not: input.applicationId },
            businessRegistrationNumberHash: input.registrationHash,
            status: { in: visibleStatuses },
          },
        })
      : Promise.resolve(0),
    transaction.merchantApplication.count({
      where: {
        id: { not: input.applicationId }, requestedSlug: input.requestedSlug, status: { in: visibleStatuses },
      },
    }),
    transaction.stall.count({ where: { slug: input.requestedSlug } }),
    transaction.merchantApplication.count({
      where: { applicantProfileId: input.profileId, status: "REJECTED" },
    }),
  ]);
  const reasons: MerchantApplicationRiskReason[] = [];
  if (email > 0) reasons.push("DUPLICATE_EMAIL");
  if (phone > 0) reasons.push("DUPLICATE_PHONE");
  if (registration > 0) reasons.push("DUPLICATE_REGISTRATION_NUMBER");
  if (slugApplication > 0 || stallSlug > 0) reasons.push("DUPLICATE_SLUG");
  if (priorRejection > 0) reasons.push("PRIOR_REJECTION");
  return reasons;
}

function applicationData(data: Partial<MerchantApplicationFields>) {
  const result: WritableApplicationData = {};
  if (data.phone !== undefined) {
    const phone = normalizeApplicationPhone(data.phone);
    result.phone = phone;
    result.phoneHash = hashApplicationIdentifier("phone", phone);
  }
  if (data.businessRegistrationNumber !== undefined) {
    const registration = normalizeRegistrationNumber(data.businessRegistrationNumber);
    result.businessRegistrationNumber = registration;
    result.businessRegistrationNumberHash = registration
      ? hashApplicationIdentifier("registration", registration)
      : null;
  }
  if (data.expectedStartDate !== undefined) {
    result.expectedStartDate = data.expectedStartDate
      ? new Date(`${data.expectedStartDate}T00:00:00.000Z`)
      : null;
  }
  const directFields = [
    "lineId", "preferredContactMethod", "merchantName", "businessType", "contactName",
    "businessPhone", "businessAddress", "city", "merchantDescription", "stallName",
    "stallLocation", "requestedSlug", "estimatedDailyOrders", "needsMultipleStaff",
    "needsKitchenView", "requestedPlanCode", "termsAccepted", "privacyAccepted",
    "dataProcessingAccepted", "informationConfirmed",
  ] as const;
  for (const field of directFields) {
    if (data[field] !== undefined) Object.assign(result, { [field]: data[field] });
  }
  return result;
}

function assertTransition(
  current: MerchantApplicationStatus,
  next: MerchantApplicationStatus,
  actor: "APPLICANT" | "PLATFORM_ADMIN",
) {
  try {
    assertMerchantApplicationTransition(current, next, actor);
  } catch {
    throw new MerchantApplicationError("MERCHANT_APPLICATION_TRANSITION_INVALID");
  }
}
