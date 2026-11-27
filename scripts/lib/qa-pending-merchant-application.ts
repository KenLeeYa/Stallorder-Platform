import type { Prisma } from "@prisma/client";

export function pendingMerchantApplication(
  applicant: { id: string; email: string; displayName: string },
  merchantName: string,
  requestedSlug: string,
): Prisma.MerchantApplicationUncheckedCreateInput {
  return {
    applicantProfileId: applicant.id,
    applicantEmail: applicant.email,
    applicantDisplayName: applicant.displayName,
    merchantName,
    businessType: "NIGHT_MARKET_STALL",
    contactName: "測試負責人",
    phone: "0912345678",
    phoneHash: "merchant-application-e2e-phone-hash",
    businessPhone: "0912345678",
    preferredContactMethod: "PHONE",
    businessAddress: "台北市測試路 1 號",
    city: "台北市",
    stallName: "申請流程測試攤位",
    stallLocation: "台北測試夜市",
    requestedSlug,
    estimatedDailyOrders: 20,
    requestedPlanCode: "TRIAL",
    status: "PENDING_REVIEW",
    currentStep: 4,
    termsAccepted: true,
    privacyAccepted: true,
    dataProcessingAccepted: true,
    informationConfirmed: true,
    consentedAt: new Date(),
    submittedAt: new Date(),
  };
}
