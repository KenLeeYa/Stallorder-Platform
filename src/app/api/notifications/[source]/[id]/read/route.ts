import type { InboxRef } from "@/lib/notification-inbox-contract";
import { inboxHttp } from "@/server/notifications/inbox-http";
export async function PATCH(request: Request, context: { params: Promise<{ source: string; id: string }> }) {
  return inboxHttp(request, "read", await context.params as InboxRef);
}
