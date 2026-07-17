import { safeEqual } from "@/lib/security";
import { processOrdersCron } from "@/lib/order-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function isAuthorized(request: Request, secret: string) {
  const authorization = request.headers.get("authorization") ?? "";
  return safeEqual(authorization, `Bearer ${secret}`);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const executedAt = new Date().toISOString();
  const secret = process.env.CRON_API_SECRET?.trim();

  if (!secret) {
    return noStoreJson({ success: false, error: "CRON_NOT_CONFIGURED", requestId }, 500);
  }

  if (!isAuthorized(request, secret)) {
    return noStoreJson({ success: false, error: "UNAUTHORIZED", requestId }, 401);
  }

  try {
    const result = await processOrdersCron();
    return noStoreJson({ success: true, executedAt, requestId, result }, 200);
  } catch (error) {
    const detail = error && typeof error === "object" && "message" in error
      ? String(error.message).replace(/[\r\n]/g, " ").slice(0, 300)
      : "unknown";
    console.error(JSON.stringify({
      level: "error",
      event: "PROCESS_ORDERS_CRON_FAILED",
      requestId,
      detail,
    }));
    return noStoreJson({ success: false, error: "PROCESS_ORDERS_FAILED", requestId }, 500);
  }
}

export async function GET() {
  return noStoreJson({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
