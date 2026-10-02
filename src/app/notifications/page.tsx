import { createHash } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { getPagePrincipal } from "@/lib/auth";
import { NotificationInbox } from "@/components/notification-inbox";
import { parseInboxSearch } from "@/server/notifications/inbox-http";
import { authorizeInbox, InboxError } from "@/server/notifications/inbox-service";
import { ZodError } from "zod";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { inboxReturnPath } from "@/lib/notification-inbox-return";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?next=%2Fnotifications%3Fkind%3DPERSONAL");
  const input = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) { if (Array.isArray(value)) notFound(); if (value !== undefined) params.set(key, value); }
  let scope;
  try { scope = parseInboxSearch(params).scope; await authorizeInbox(principal, scope); }
  catch (error) { if (error instanceof InboxError || error instanceof ZodError) notFound(); throw error; }
  const identity = createHash("sha256").update(JSON.stringify([principal.user.id, principal.sessionId, scope])).digest("hex");
  return <main className="mx-auto max-w-3xl px-4 py-6"><ContextualBackButton fallbackHref={inboxReturnPath(scope)}>返回</ContextualBackButton><h1 className="mb-4 mt-3 text-2xl font-semibold">通知中心</h1><NotificationInbox scope={scope} identity={identity} /></main>;
}
