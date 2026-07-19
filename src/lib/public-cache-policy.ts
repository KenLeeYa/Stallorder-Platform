const PUBLIC_MENU_BROWSER_POLICY = "public, max-age=0, must-revalidate";
const PUBLIC_MENU_VERCEL_POLICY = "public, s-maxage=15, stale-while-revalidate=15";
const PUBLIC_MENU_CDN_POLICY = "public, s-maxage=10, stale-while-revalidate=10";

export function publicMenuResponseHeaders(request: Request) {
  if (request.headers.has("authorization") || request.headers.has("cookie")) {
    return privateNoStoreHeaders();
  }

  return {
    "cache-control": PUBLIC_MENU_BROWSER_POLICY,
    "vercel-cdn-cache-control": PUBLIC_MENU_VERCEL_POLICY,
    "cdn-cache-control": PUBLIC_MENU_CDN_POLICY,
  };
}

export function privateNoStoreHeaders() {
  return {
    "cache-control": "private, no-store, max-age=0",
  };
}
