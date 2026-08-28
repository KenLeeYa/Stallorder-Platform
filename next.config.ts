import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const allowedDevOrigins = [
  "127.0.0.1",
  ...(process.env.LOCAL_DEV_ALLOWED_ORIGINS?.split(",") ?? []),
].map((value) => value.trim()).filter(Boolean);
const publicEdgeOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL).origin
      : "http://127.0.0.1:54321";
  } catch {
    return "http://127.0.0.1:54321";
  }
})();
const publicRealtimeOrigin = (() => {
  try {
    const value = process.env.NEXT_PUBLIC_SUPABASE_REALTIME_URL
      ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    return value ? new URL(value).origin : publicEdgeOrigin;
  } catch {
    return publicEdgeOrigin;
  }
})();
const productImageRemotePatterns = (() => {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    return [{
      protocol: url.protocol.slice(0, -1) as "http" | "https",
      hostname: url.hostname,
      port: url.port,
      pathname: "/storage/v1/object/public/product-images/**",
    }];
  } catch {
    return [];
  }
})();
const productImageRuntimeFiles = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${publicEdgeOrigin}`,
  "font-src 'self'",
  `connect-src 'self' ${publicEdgeOrigin} ${publicRealtimeOrigin} https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com https://www.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_STALLORDER_BUILD_REVISION:
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local",
  },
  allowedDevOrigins,
  outputFileTracingIncludes: {
    "/api/merchant/**/image": productImageRuntimeFiles,
    "/api/merchant/**/cover-image": productImageRuntimeFiles,
  },
  logging: {
    incomingRequests: {
      ignore: [
        /\/api\/auth\/(?:google|line|apple)\/callback/,
        /\/api\/auth\/mock\/authorize/,
      ],
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: productImageRemotePatterns,
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Vercel-CDN-Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400" },
          { key: "CDN-Cache-Control", value: "public, s-maxage=600, stale-while-revalidate=3600" },
        ],
      },
      {
        source: "/login",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Vercel-CDN-Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=3600" },
          { key: "CDN-Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=300" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/q/:qrToken",
        headers: [
          { key: "X-StallOrder-Offline-Cache", value: "public-menu-v1" },
        ],
      },
      {
        source: "/store/:identifier",
        headers: [
          { key: "X-StallOrder-Offline-Cache", value: "public-menu-v1" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
