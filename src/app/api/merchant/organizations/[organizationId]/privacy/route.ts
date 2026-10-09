import { z } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { createRequestId } from "@/lib/security";
import { ComplianceError, requireCompliance } from "@/server/compliance/access";
import { requestTransition } from "@/server/compliance/contracts";
import { listPrivacyRequests, transitionPrivacyRequest } from "@/server/compliance/privacy-service";
import { complianceFailure, complianceJson } from "@/server/compliance/http";
import { governanceCommand, incidentCommand } from "@/server/compliance/governance-contracts";
import { runGovernanceCommand } from "@/server/compliance/governance-service";
import { recordIncident } from "@/server/compliance/incident-service";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    requireCompliance();
    const principal = await getRequestPrincipal(request);
    if (!principal) throw new ComplianceError("LOGIN_REQUIRED", 401);
    const { organizationId } = await context.params;
    const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
    if (!z.uuid().safeParse(organizationId).success || !Number.isInteger(page) || page < 1 || page > 10000) throw new ComplianceError("INVALID_REQUEST", 400);
    return complianceJson({ requests: await listPrivacyRequests(principal, organizationId, page, requestId) });
  } catch (error) { return complianceFailure(error, requestId); }
}
export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    requireCompliance();
    const principal = await getRequestPrincipal(request);
    if (!principal) throw new ComplianceError("LOGIN_REQUIRED", 401);
    if (!validateCsrf(request, principal)) throw new ComplianceError("CSRF_DENIED", 403);
    const { organizationId } = await context.params;
    if (!z.uuid().safeParse(organizationId).success) throw new ComplianceError("INVALID_REQUEST", 400);
    const body = await readJson(request, requestId, { maxBytes: 10000 });
    if (body.error) return body.error;
    const command = requestTransition.safeParse(body.data);
    if (!command.success) throw new ComplianceError("INVALID_REQUEST", 400);
    return complianceJson(await transitionPrivacyRequest(principal, organizationId, command.data, requestId, request.headers.get("x-step-up-grant")));
  } catch (error) { return complianceFailure(error, requestId); }
}
export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    requireCompliance();
    const principal = await getRequestPrincipal(request);
    if (!principal) throw new ComplianceError("LOGIN_REQUIRED", 401);
    if (!validateCsrf(request, principal)) throw new ComplianceError("CSRF_DENIED", 403);
    const { organizationId } = await context.params;
    if (!z.uuid().safeParse(organizationId).success) throw new ComplianceError("INVALID_REQUEST", 400);
    const body = await readJson(request, requestId, { maxBytes: 12000 });
    if (body.error) return body.error;
    const incident = z.object({ action: z.literal("INCIDENT"), command: incidentCommand }).strict().safeParse(body.data);
    if (incident.success) return complianceJson(await recordIncident(principal, organizationId, incident.data.command, requestId));
    const command = governanceCommand.safeParse(body.data);
    if (!command.success) throw new ComplianceError("INVALID_REQUEST", 400);
    return complianceJson(await runGovernanceCommand(principal, organizationId, command.data, requestId, request.headers.get("x-step-up-grant")));
  } catch (error) { return complianceFailure(error, requestId); }
}
