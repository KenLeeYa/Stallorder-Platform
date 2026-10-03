import type { PublicStorefrontSearchParams } from "@/lib/public-storefront";
import PublicStorefrontPage, { generateStorefrontMetadata } from "./storefront-page";

export const dynamic = "force-dynamic";
export const generateMetadata = generateStorefrontMetadata;
export default function StorefrontPage(props: {
  params: Promise<{ identifier: string }>;
  searchParams: Promise<PublicStorefrontSearchParams>;
}) {
  return PublicStorefrontPage(props);
}
