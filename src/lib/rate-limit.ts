import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

type RateLimitOptions = { scope: string; identifier: string; limit: number; windowMs: number };

export async function checkRateLimit(options: RateLimitOptions) {
  const key = createHash("sha256").update(`${options.scope}:${options.identifier}`).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.windowMs);
  const [bucket] = await prisma.$queryRaw<Array<{ count: number; expiresAt: Date }>>`
    insert into public.rate_limit_buckets (key, count, expires_at, updated_at)
    values (${key}, 1, ${expiresAt}, ${now})
    on conflict (key) do update set
      count = case
        when public.rate_limit_buckets.expires_at <= ${now} then 1
        else public.rate_limit_buckets.count + 1
      end,
      expires_at = case
        when public.rate_limit_buckets.expires_at <= ${now} then ${expiresAt}
        else public.rate_limit_buckets.expires_at
      end,
      updated_at = ${now}
    returning count, expires_at as "expiresAt"
  `;

  return {
    allowed: bucket.count <= options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000)),
  };
}
