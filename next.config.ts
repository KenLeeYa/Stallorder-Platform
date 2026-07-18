import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const publicEdgeOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL).origin
      : "http://127.0.0.1:54321";
  } catch {
    return "http://127.0.0.1:54321";
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
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${publicEdgeOrigin}`,
  "font-src 'self'",
  `connect-src 'self' ${publicEdgeOrigin} https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: productImageRemotePatterns,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
