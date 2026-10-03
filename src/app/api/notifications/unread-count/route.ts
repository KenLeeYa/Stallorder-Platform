import { inboxHttp } from "@/server/notifications/inbox-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return inboxHttp(request, "count"); }
