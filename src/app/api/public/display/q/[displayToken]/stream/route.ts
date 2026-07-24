import { z } from "zod";
import { pickupDisplayAccessByTokenHash } from "@/lib/pickup-display";
import { publicPickupDisplayStream } from "@/lib/pickup-display-http";
import { hashToken } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const displayTokenSchema = z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/);

type RouteContext = { params: Promise<{ displayToken: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { displayToken } = await context.params;
  const parsed = displayTokenSchema.safeParse(displayToken);
  const tokenHash = hashToken(parsed.success ? parsed.data : "invalid");
  return publicPickupDisplayStream(
    request,
    tokenHash,
    () => parsed.success
      ? pickupDisplayAccessByTokenHash(tokenHash)
      : Promise.resolve(null),
  );
}
