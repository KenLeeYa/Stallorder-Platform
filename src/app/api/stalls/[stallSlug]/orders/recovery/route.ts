import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeApiRequest } from "@/lib/authorization";
import { serializeStaffOrder } from "@/lib/orders";
import { findStaffOrderRecovery } from "@/lib/staff-order-create";

const query = z.object({ actorProfileId: z.string().uuid(), idempotencyKey: z.string().uuid() });
export async function GET(request: Request, context: { params: Promise<{ stallSlug: string }> }) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "CREATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  const headers = { "cache-control": "no-store", "x-request-id": authorization.requestId };
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_RECOVERY_IDENTITY" }, { status: 400, headers });
  if (parsed.data.actorProfileId !== authorization.principal.user.id) {
    return NextResponse.json({ error: "RECOVERY_ACTOR_MISMATCH" }, { status: 403, headers });
  }
  const order = await findStaffOrderRecovery({ organizationId: authorization.stall.organizationId,
    stallId: authorization.stall.id, actorProfileId: authorization.principal.user.id,
    idempotencyKey: parsed.data.idempotencyKey });
  return NextResponse.json(order ? { status: "FOUND", order: serializeStaffOrder(order) } : { status: "UNKNOWN" }, { headers });
}
