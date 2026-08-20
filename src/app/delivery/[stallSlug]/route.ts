import { redirectLegacyPublicStorefront } from "@/lib/legacy-public-storefront-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ stallSlug: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { stallSlug } = await params;
  return redirectLegacyPublicStorefront(request, stallSlug, "delivery");
}
