import { NextResponse, type NextRequest } from "next/server";
import { authorizeDrAccessRequest } from "@/lib/cloudflare-access";
import { buildMerchantRouteRequestHeaders } from "@/lib/workspace-route-context";

export async function proxy(request: NextRequest) {
  const authorized = await authorizeDrAccessRequest({
    hostname: request.headers.get("host") ?? request.nextUrl.host,
    headers: request.headers,
  });
  if (!authorized) {
    return new NextResponse(null, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  if (!request.nextUrl.pathname.startsWith("/merchant")) {
    return NextResponse.next();
  }

  const requestHeaders = buildMerchantRouteRequestHeaders(
    request.headers,
    request.nextUrl.pathname,
    request.nextUrl.searchParams.getAll("organizationId"),
    request.nextUrl.searchParams.getAll("stallId"),
  );

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
