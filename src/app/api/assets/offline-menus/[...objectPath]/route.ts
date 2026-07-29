const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const objectPathPattern = new RegExp(
  `^${uuidPattern}/${uuidPattern}/[1-9][0-9]{0,9}-(?:[0-9]{13}-)?[a-f0-9]{64}\\.json$`,
);

type RouteContext = { params: Promise<{ objectPath: string[] }> };

function storageObjectUrl(baseUrl: string, objectPath: string) {
  const url = new URL(baseUrl);
  url.pathname = `/storage/v1/object/public/offline-menu-snapshots/${objectPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function orderedStorageOrigins() {
  const primary = process.env.PRIMARY_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dr = process.env.DR_SUPABASE_URL;
  return process.env.BACKEND_ACTIVE_TARGET === "DR"
    ? [dr, primary]
    : [primary, dr];
}

export async function GET(_request: Request, context: RouteContext) {
  const { objectPath: segments } = await context.params;
  const objectPath = segments.join("/");
  if (!objectPathPattern.test(objectPath)) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  for (const origin of orderedStorageOrigins()) {
    if (!origin) continue;
    try {
      const response = await fetch(storageObjectUrl(origin, objectPath), {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !response.body || !contentType.startsWith("application/json")) continue;
      return new Response(response.body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=31536000, immutable",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      // The immutable object may be served from the standby storage origin.
    }
  }

  return new Response(null, {
    status: 404,
    headers: { "cache-control": "public, max-age=30" },
  });
}
