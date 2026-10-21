import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getPaginatedOrganizationProducts } from "@/lib/catalog-data";
import { hasPermission } from "@/lib/rbac";
import { catalogReadInputSchema, catalogReadResultSchema } from "@/lib/operations-read-contract";
import { createOperationsScope } from "@/server/operations-read-scope";
import { operationsAuthorizationFailure, operationsReadFailure, operationsReadResponse } from "@/server/operations-read-response";

export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const authorized = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SHARED_PRODUCTS", true);
  if (!authorized.ok) return operationsAuthorizationFailure(authorized.response);
  if (!authorized.workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) return operationsReadFailure(403, authorized.requestId);
  const parameters = new URL(request.url).searchParams;
  if ([...parameters.keys()].some((key) => parameters.getAll(key).length > 1)) return operationsReadFailure(400, authorized.requestId);
  const input = catalogReadInputSchema.safeParse(Object.fromEntries(parameters));
  if (!input.success) return operationsReadFailure(400, authorized.requestId);
  try {
    const result = await getPaginatedOrganizationProducts(organizationId, authorized.authorizedStallIds, input.data);
    return operationsReadResponse(catalogReadResultSchema.parse({ version: "v1", scope: createOperationsScope(authorized.principal, authorized.workspace, authorized.authorizedStallIds), ...result }), authorized.requestId);
  } catch (error) { return operationsReadFailure(error instanceof Error && error.message === "OPERATIONS_NOT_FOUND" ? 404 : 500, authorized.requestId); }
}
