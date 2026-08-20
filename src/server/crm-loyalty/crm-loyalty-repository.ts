import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CrmConsentOptIn,
  CrmConsentWithdrawal,
  CrmDataSubjectRequest,
  CrmErasureRequest,
  CrmUnsubscribe,
  LoyaltyPointsEvent,
} from "@/server/crm-loyalty/crm-loyalty-contract";

export type CrmLoyaltyRpcResult = {
  ok: boolean;
  code: string;
  [key: string]: unknown;
};

async function jsonResult(query: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ result: CrmLoyaltyRpcResult | null }>>(query);
  return rows[0]?.result ?? null;
}

export function optInCrmLoyaltyProfile(input: CrmConsentOptIn & { requestId: string }) {
  return jsonResult(Prisma.sql`
    select public.opt_in_crm_loyalty_profile(
      ${input.organizationId}::uuid, ${input.stallId}::uuid,
      ${input.contactIdentifierHash}::text, ${input.contactReference}::text,
      ${input.contactType}::text, ${input.contactVerifiedAt}::timestamptz,
      ${input.purposeCode}::text, ${input.noticeVersion}::text,
      ${input.consentSource}::text, ${input.lawfulBasis}::text,
      ${input.decision}::text, ${input.requestId}::text
    ) as result
  `);
}

export function withdrawCrmConsent(input: CrmConsentWithdrawal & { requestId: string }) {
  return jsonResult(Prisma.sql`
    select public.withdraw_crm_consent(
      ${input.organizationId}::uuid, ${input.stallId}::uuid,
      ${input.profileId}::uuid, ${input.purposeCode}::text,
      ${input.withdrawalSource}::text, ${input.withdrawalReason}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function unsubscribeCrmProfile(input: CrmUnsubscribe & { requestId: string }) {
  return jsonResult(Prisma.sql`
    select public.unsubscribe_crm_profile(
      ${input.organizationId}::uuid, ${input.stallId}::uuid,
      ${input.profileId}::uuid, ${input.unsubscribeSource}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function postLoyaltyPointsEvent(input: LoyaltyPointsEvent & { requestId: string }) {
  return jsonResult(Prisma.sql`
    select public.post_loyalty_points_event(
      ${input.organizationId}::uuid, ${input.stallId}::uuid,
      ${input.accountId}::uuid, ${input.entryType}::text,
      ${input.pointsDelta}::integer, ${input.orderId ?? null}::uuid,
      ${input.sourceEventType}::text, ${input.sourceEventId}::text,
      ${input.reversalOfLedgerId ?? null}::uuid,
      ${input.actorProfileId ?? null}::uuid, ${input.requestId}::text
    ) as result
  `);
}

export function exportCrmLoyaltyProfile(input: CrmDataSubjectRequest & { requestId: string }) {
  return jsonResult(Prisma.sql`
    select public.export_crm_loyalty_profile(
      ${input.organizationId}::uuid, ${input.stallId}::uuid,
      ${input.profileId}::uuid, ${input.requestId}::text
    ) as result
  `);
}

export function eraseCrmLoyaltyProfile(input: CrmErasureRequest & { requestId: string }) {
  return jsonResult(Prisma.sql`
    select public.erase_crm_loyalty_profile(
      ${input.organizationId}::uuid, ${input.stallId}::uuid,
      ${input.profileId}::uuid, ${input.subjectHash}::text,
      ${input.reason}::text, ${input.requestId}::text
    ) as result
  `);
}
