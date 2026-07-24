import { z } from "zod";
import { getPublicPickupDisplayByTokenHash } from "@/lib/pickup-display";
import { publicPickupDisplayResponse } from "@/lib/pickup-display-http";
import { hashToken } from "@/lib/security";

const displayTokenSchema = z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/);

type RouteContext = { params: Promise<{ displayToken: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { displayToken } = await context.params;
  const parsed = displayTokenSchema.safeParse(displayToken);
  const tokenHash = hashToken(parsed.success ? parsed.data : "invalid");
  return publicPickupDisplayResponse(
    request,
    tokenHash,
    "/api/public/display/q/:displayToken",
    () => parsed.success
      ? getPublicPickupDisplayByTokenHash(tokenHash)
      : Promise.resolve(null),
  );
}
