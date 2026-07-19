import { disabledWebhookResponse } from "@/server/billing/providers/disabled-webhook-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return disabledWebhookResponse("NEWEBPAY_BILLING_ENABLED");
}
