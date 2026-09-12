import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { pushConfig, validPushReceipt } from "@/server/notifications/staff-push-crypto";

// The service worker has no access to document CSRF cookies. A per-delivery HMAC
// authorizes only its display acknowledgement, for a bounded time.
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 512) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 512) return new Response(null, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const input = z.object({ id: z.uuid(), token: z.string().length(43) }).strict().safeParse(value);
  const config = pushConfig();
  if (!input.success || !config || !validPushReceipt(input.data.id, input.data.token, config.encryptionKey)) {
    return new Response(null, { status: 403 });
  }
  await prisma.staffPushDelivery.updateMany({
    where: { id: input.data.id, status: { in: ["PROCESSING", "SENT"] }, displayedAt: null,
      expiresAt: { gt: new Date(Date.now() - 300_000) } },
    data: { displayedAt: new Date() },
  });
  return new Response(null, { status: 204 });
}
