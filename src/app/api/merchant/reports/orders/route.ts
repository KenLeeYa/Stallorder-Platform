import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { historyReadInputSchema, historyReadResultSchema } from "@/lib/operations-read-contract";
import { resolveReportReadScope } from "@/lib/report-scope";
import { getOperationsOrderHistoryPage } from "@/lib/report-data";
import { createOperationsScope } from "@/server/operations-read-scope";
import { operationsAuthorizationFailure, operationsReadFailure, operationsReadResponse } from "@/server/operations-read-response";

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const org = parameters.get("organizationId") ?? "";
  const authorized = await authorizeOrganizationApiRequest(request, org, "VIEW_REPORTS", true);
  if (!authorized.ok) return operationsAuthorizationFailure(authorized.response);
  if ([...parameters.keys()].some((key) => key !== "stallId" && parameters.getAll(key).length > 1)) return operationsReadFailure(400, authorized.requestId);
  const values = Object.fromEntries(parameters); delete values.stallId;
  const input = historyReadInputSchema.safeParse({ ...values, stallIds: parameters.getAll("stallId") });
  if (!input.success) return operationsReadFailure(400, authorized.requestId);
  try {
    const resolved = resolveReportReadScope(authorized.workspace, input.data.stallIds, input.data.dateFrom, input.data.dateTo);
    const ids = resolved.stalls.map((s) => s.id);
    const result = await getOperationsOrderHistoryPage(org, ids, resolved.dateFrom, resolved.dateTo, input.data);
    return operationsReadResponse(historyReadResultSchema.parse({ version: "v1", scope: createOperationsScope(authorized.principal, authorized.workspace, ids), ...result }), authorized.requestId);
  } catch (error) { return operationsReadFailure(error instanceof Error && error.message === "OPERATIONS_NOT_FOUND" ? 404 : error instanceof Error && error.message === "OPERATIONS_INVALID_DATES" ? 400 : 500, authorized.requestId); }
}
