import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  DynamicQrIssueCommand,
  DynamicQrRedeemCommand,
  DynamicQrRepository,
} from "./credential-service";

async function issue(input: DynamicQrIssueCommand) {
  const rows = await prisma.$queryRaw<Array<{ result: Awaited<ReturnType<DynamicQrRepository["issue"]>> }>>(
    Prisma.sql`
      select public.issue_dynamic_qr_credential(
        ${input.organizationId}::uuid,
        ${input.stallId}::uuid,
        ${input.diningTableId}::uuid,
        ${input.staticQrCodeId}::uuid,
        ${input.orderSessionId}::uuid,
        ${input.tokenHash}::text,
        ${input.nonceHash}::text,
        ${input.deviceHash}::text,
        ${input.ipHash}::text,
        ${input.requestId}::text
      ) as result
    `,
  );
  return rows[0]?.result ?? null;
}

async function redeem(input: DynamicQrRedeemCommand) {
  const rows = await prisma.$queryRaw<Array<{ result: Awaited<ReturnType<DynamicQrRepository["redeem"]>> }>>(
    Prisma.sql`
      select public.redeem_dynamic_qr_credential(
        ${input.tokenHash}::text,
        ${input.nonceHash}::text,
        ${input.staticQrToken}::text,
        ${input.deviceHash}::text,
        ${input.ipHash}::text,
        ${input.requestId}::text
      ) as result
    `,
  );
  return rows[0]?.result ?? null;
}

export const dynamicQrRepository: DynamicQrRepository = { issue, redeem };
