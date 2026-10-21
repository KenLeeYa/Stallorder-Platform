import { feedbackHttp } from "@/server/feedback/feedback-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = (request: Request) => feedbackHttp(request, "submit");
