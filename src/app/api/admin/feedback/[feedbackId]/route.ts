import { feedbackHttp } from "@/server/feedback/feedback-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = {
    params: Promise<{
        feedbackId: string;
    }>;
};
export async function GET(request: Request, context: Context) { return feedbackHttp(request, "detail", (await context.params).feedbackId); }
export async function PATCH(request: Request, context: Context) { return feedbackHttp(request, "update", (await context.params).feedbackId); }
