import { handleCanonicalDeliveryWebhook } from "@/server/delivery-platforms/canonical-webhook-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleCanonicalDeliveryWebhook("FOODPANDA", request);
}
