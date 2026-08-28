import { prisma } from "@/lib/prisma";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const objectPathPattern = new RegExp(
  `^${uuidPattern}/(?:${uuidPattern}|stall-(?:banners|location-guides)/${uuidPattern}/${uuidPattern})\\.webp$`,
);

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ objectPath: string[] }> };

function storageObjectUrl(baseUrl: string, objectPath: string) {
  const url = new URL(baseUrl);
  url.pathname = `/storage/v1/object/authenticated/product-images/${objectPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function orderedStorageBackends() {
  const primary = backend(
    process.env.PRIMARY_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.PRIMARY_SUPABASE_SECRET_KEY
      ?? process.env.PRIMARY_SUPABASE_SERVICE_ROLE_KEY
      ?? process.env.SUPABASE_SECRET_KEY,
  );
  const dr = backend(
    process.env.DR_SUPABASE_URL,
    process.env.DR_SUPABASE_SECRET_KEY ?? process.env.DR_SUPABASE_SERVICE_ROLE_KEY,
  );
  return process.env.BACKEND_ACTIVE_TARGET === "DR"
    ? [dr, primary]
    : [primary, dr];
}

function backend(url: string | undefined, secret: string | undefined) {
  return url?.trim() && secret?.trim() ? { url, secret } : null;
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

  try {
    const manifest = await prisma.storageObjectManifest.findUnique({
      where: { bucket_objectPath: { bucket: "product-images", objectPath } },
      select: { deletedAt: true },
    });
    if (manifest?.deletedAt) {
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "5" },
    });
  }

  const backends = orderedStorageBackends();
  if (!backends.some(Boolean)) {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "5" },
    });
  }

  for (const storage of backends) {
    if (!storage) continue;
    try {
      const response = await fetch(storageObjectUrl(storage.url, objectPath), {
        headers: {
          accept: "image/webp,image/*",
          apikey: storage.secret,
          authorization: `Bearer ${storage.secret}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !response.body || !contentType.startsWith("image/")) continue;
      return new Response(response.body, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=60, must-revalidate",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      // Try the standby origin. No provider details are exposed to the client.
    }
  }

  return new Response(null, {
    status: 404,
    headers: { "cache-control": "public, max-age=30" },
  });
}
