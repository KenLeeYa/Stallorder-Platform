import { NextResponse } from "next/server";
import {
  buildPublicStorefrontPath,
  resolveLegacyPublicStorefrontSlug,
  type PublicStorefrontSearchParams,
  type PublicStorefrontView,
} from "@/lib/public-storefront";

const ROBOTS_HEADER = { "X-Robots-Tag": "noindex, nofollow" };

export async function redirectLegacyPublicStorefront(
  request: Request,
  stallSlug: string,
  view: PublicStorefrontView,
) {
  const resolution = await resolveLegacyPublicStorefrontSlug(stallSlug);
  if (!resolution) {
    return new NextResponse(null, { status: 404, headers: ROBOTS_HEADER });
  }

  const requestUrl = new URL(request.url);
  const destination = buildPublicStorefrontPath(
    resolution.canonicalIdentifier,
    view,
    collectSearchParams(requestUrl.searchParams),
  );
  return new NextResponse(null, {
    status: 307,
    headers: {
      ...ROBOTS_HEADER,
      "Cache-Control": "no-store",
      Location: destination,
    },
  });
}

function collectSearchParams(searchParams: URLSearchParams): PublicStorefrontSearchParams {
  const result: PublicStorefrontSearchParams = {};
  for (const [key, value] of searchParams) {
    const current = result[key];
    result[key] = current === undefined
      ? value
      : Array.isArray(current)
        ? [...current, value]
        : [current, value];
  }
  return result;
}
