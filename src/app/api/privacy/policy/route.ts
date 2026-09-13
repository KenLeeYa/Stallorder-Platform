import { prisma } from "@/lib/prisma";
import { createRequestId } from "@/lib/security";
import { requireCompliance, ComplianceError } from "@/server/compliance/access";
import { complianceFailure, complianceJson } from "@/server/compliance/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    requireCompliance();
    const rows = await prisma.$queryRaw<{ version: string; notice_text: string }[]>`select version, notice_text
      from public.privacy_policy_versions where approved_by is not null and effective_at <= now()
      order by effective_at desc, version desc limit 1`;
    if (!rows[0]) throw new ComplianceError("PRIVACY_POLICY_NOT_APPROVED", 503);
    return complianceJson(rows[0]);
  } catch (error) { return complianceFailure(error, createRequestId()); }
}
