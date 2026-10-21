import type { InboxRef } from "@/lib/notification-inbox-contract";
import { inboxHttp } from "@/server/notifications/inbox-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ source: string; id: string }> }) {
  return inboxHttp(request, "detail", await context.params as InboxRef);
}
