import { hmacHex, sha256Hex } from "./crypto.ts";
import { requireEnv } from "./env.ts";
import { getGatewayClientIp, HttpInputError } from "./http.ts";
import { createServiceClient } from "./supabase.ts";

export async function resolveTrackedOrder(input: {
  request: Request;
  requestId: string;
  trackingToken: string;
  deviceId: string;
  behavior: string;
}) {
  const trackingHash = await sha256Hex(input.trackingToken);
  const abuseSecret = requireEnv("ABUSE_HASH_SECRET");
  const [ipHash, deviceHash, behaviorHash] = await Promise.all([
    hmacHex(abuseSecret, `ip:${getGatewayClientIp(input.request)}`),
    hmacHex(abuseSecret, `device:${input.deviceId}`),
    hmacHex(abuseSecret, `${input.behavior}:${trackingHash}`),
  ]);
  const admin = createServiceClient();
  const { data: gateData, error: gateError } = await admin.rpc(
    "check_global_public_request_gate",
    {
      p_scope: "TRACKING",
      p_ip_hash: ipHash,
      p_device_hash: deviceHash,
      p_behavior_hash: behaviorHash,
      p_request_id: input.requestId,
    },
  );
  if (gateError) throw gateError;
  const gate = gateData as { ok?: boolean; code?: string } | null;
  if (!gate?.ok) throw new HttpInputError(gate?.code ?? "RATE_LIMITED", 429);

  const { data: trackedData, error: trackedError } = await admin.rpc("get_public_order", {
    p_tracking_token_hash: trackingHash,
    p_device_hash: deviceHash,
  });
  if (trackedError) throw trackedError;
  const tracked = trackedData as { orderId?: string } | null;
  if (!tracked?.orderId) throw new HttpInputError("ORDER_NOT_FOUND", 404);

  const { data: order, error: orderError } = await admin.from("orders")
    .select("id, organization_id, stall_id, status, fulfillment_type, dining_table_id")
    .eq("id", tracked.orderId)
    .single();
  if (orderError || !order) throw orderError ?? new HttpInputError("ORDER_NOT_FOUND", 404);
  return { admin, order, trackingHash, deviceHash, ipHash };
}
