import { feedbackHttp } from "@/server/feedback/feedback-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (request: Request) => feedbackHttp(request, "list");
