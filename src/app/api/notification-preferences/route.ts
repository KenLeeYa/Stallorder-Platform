import { inboxHttp } from "@/server/notifications/inbox-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return inboxHttp(request, "preferences"); }
export async function PATCH(request: Request) { return inboxHttp(request, "preferences"); }
