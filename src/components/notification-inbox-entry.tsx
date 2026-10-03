import { createHash } from "node:crypto";
import { getPagePrincipal } from "@/lib/auth";
import type { InboxScope } from "@/lib/notification-inbox-contract";
import { authorizeInbox, InboxError } from "@/server/notifications/inbox-service";
import { NotificationInboxBadge } from "./notification-inbox";

export async function NotificationInboxEntry({ scope }: { scope: InboxScope }) {
  const principal = await getPagePrincipal();
  if (!principal) return null;
  try { await authorizeInbox(principal, scope); } catch (error) { if (error instanceof InboxError) return null; throw error; }
  const identity = createHash("sha256").update(JSON.stringify([principal.user.id, principal.sessionId, scope])).digest("hex");
  return <NotificationInboxBadge scope={scope} identity={identity} />;
}
