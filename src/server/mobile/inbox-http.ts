import "server-only";
import type { InboxRef } from "@stallorder/contracts/notifications/v1";
import { authorizeMobileApiRequest } from "./authorization";
import { authenticatedInboxHttp } from "@/server/notifications/inbox-http";
export async function mobileInboxHttp(request: Request, operation: "list"|"count"|"detail"|"read"|"preferences", ref?: InboxRef) {
 const auth = await authorizeMobileApiRequest(request);
 if (!auth.ok) return auth.response;
 return authenticatedInboxHttp(request, operation, ref, auth.principal, auth.requestId, false);
}
