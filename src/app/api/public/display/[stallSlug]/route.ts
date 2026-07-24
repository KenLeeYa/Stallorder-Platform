import { z } from "zod";
import { getPublicPickupDisplayBySlug } from "@/lib/pickup-display";
import { publicPickupDisplayResponse } from "@/lib/pickup-display-http";
import { hashToken } from "@/lib/security";

const stallSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const parsed = stallSlugSchema.safeParse(stallSlug);
  const safeSlug = parsed.success ? parsed.data : "invalid";
  return publicPickupDisplayResponse(
    request,
    hashToken(safeSlug),
    "/api/public/display/:stallSlug",
    () => parsed.success ? getPublicPickupDisplayBySlug(parsed.data) : Promise.resolve(null),
  );
}
