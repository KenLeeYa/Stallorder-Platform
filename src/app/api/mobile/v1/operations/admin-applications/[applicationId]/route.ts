import { authorizeMobileApiRequest } from "@/server/mobile/authorization";
import { z } from "zod";
import { applicationDetailResultSchema } from "@/lib/operations-read-contract";
import { createOperationsScope } from "@/server/operations-read-scope";
import { operationsAuthorizationFailure, operationsReadFailure, operationsReadResponse } from "@/server/operations-read-response";
import {
  approveMerchantApplication,
  MerchantApprovalError,
} from "@/server/merchant-applications/approve-merchant-application";
import {
  applyMerchantApplicationReviewAction,
  MerchantApplicationReviewError,
  getMerchantApplicationForAdmin,
} from "@/server/merchant-applications/merchant-application-admin-service";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeMobileApiRequest(request);
  if (!authorization.ok) return operationsAuthorizationFailure(authorization.response);
  if (authorization.principal.user.platformRole !== "PLATFORM_ADMIN") return operationsReadFailure(404, authorization.requestId);
  const { applicationId } = await context.params;
  if (!z.uuid().safeParse(applicationId).success) return operationsReadFailure(404, authorization.requestId);
  if (new URL(request.url).search) return operationsReadFailure(400, authorization.requestId);
  try {
    const detail = await getMerchantApplicationForAdmin(applicationId);
    if (!detail) return operationsReadFailure(404, authorization.requestId);
    return operationsReadResponse(applicationDetailResultSchema.parse({ version: "v1", scope: createOperationsScope(authorization.principal), detail }), authorization.requestId);
  } catch { return operationsReadFailure(500, authorization.requestId); }
}
