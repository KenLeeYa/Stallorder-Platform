import { NextResponse, type NextRequest } from "next/server";
import { buildMerchantRouteRequestHeaders } from "@/lib/workspace-route-context";

export function proxy(request: NextRequest) {
  const requestHeaders = buildMerchantRouteRequestHeaders(
    request.headers,
    request.nextUrl.pathname,
    request.nextUrl.searchParams.getAll("organizationId"),
    request.nextUrl.searchParams.getAll("stallId"),
  );

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/merchant/:path*"],
};
