import { authorizeMobileApiRequest } from "@/server/mobile/authorization";
import { applicationReadInputSchema, applicationReadResultSchema } from "@/lib/operations-read-contract";
import { listPaginatedMerchantApplications } from "@/server/merchant-applications/merchant-application-admin-service";
import { createOperationsScope } from "@/server/operations-read-scope";
import { operationsAuthorizationFailure, operationsReadFailure, operationsReadResponse } from "@/server/operations-read-response";

export async function GET(request: Request) {
  const authorized = await authorizeMobileApiRequest(request);
  if (!authorized.ok) return operationsAuthorizationFailure(authorized.response);
  if (authorized.principal.user.platformRole !== "PLATFORM_ADMIN") return operationsReadFailure(404, authorized.requestId);
  const parameters = new URL(request.url).searchParams;
  if ([...parameters.keys()].some((key) => parameters.getAll(key).length > 1)) return operationsReadFailure(400, authorized.requestId);
  const input = applicationReadInputSchema.safeParse(Object.fromEntries(parameters));
  if (!input.success) return operationsReadFailure(400, authorized.requestId);
  try { return operationsReadResponse(applicationReadResultSchema.parse({ version: "v1", scope: createOperationsScope(authorized.principal), ...await listPaginatedMerchantApplications(input.data) }), authorized.requestId); }
  catch { return operationsReadFailure(500, authorized.requestId); }
}
