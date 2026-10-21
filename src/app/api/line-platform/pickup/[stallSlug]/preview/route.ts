import { handlePickupStaffCommand } from "@/server/line-platform/pickup-http";
export async function POST(request: Request, context: { params: Promise<{ stallSlug: string }> }) {
  return handlePickupStaffCommand(request, (await context.params).stallSlug, "preview");
}
