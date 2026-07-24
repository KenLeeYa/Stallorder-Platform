import { z } from "zod";
import { pickupDisplayAccessBySlug } from "@/lib/pickup-display";
import { publicPickupDisplayStream } from "@/lib/pickup-display-http";
import { hashToken } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const stallSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const parsed = stallSlugSchema.safeParse(stallSlug);
  const safeSlug = parsed.success ? parsed.data : "invalid";
  return publicPickupDisplayStream(
    request,
    hashToken(safeSlug),
    () => parsed.success ? pickupDisplayAccessBySlug(parsed.data) : Promise.resolve(null),
  );
}
