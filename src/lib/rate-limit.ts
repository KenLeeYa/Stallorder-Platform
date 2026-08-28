import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

type RateLimitOptions = { scope: string; identifier: string; limit: number; windowMs: number };

const MAX_BUCKETS_PER_SCOPE = 10_000;

type PublicRateLimitOptions = {
  scope: string;
  sourceIdentifier: string;
  resourceIdentifier: string;
  sourceLimit: number;
  resourceLimit: number;
  windowMs: number;
};

export async function checkRateLimit(options: RateLimitOptions) {
  const key = createHash("sha256").update(`${options.scope}:${options.identifier}`).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.windowMs);
  const [bucket] = await prisma.$queryRaw<Array<{ count: number; expiresAt: Date }>>`
    with scope_lock as (
      select pg_advisory_xact_lock(
        hashtextextended(${`rate-limit-cardinality:${options.scope}`}, 0)
      )
    ), expired as (
      select key
      from public.rate_limit_buckets
      where expires_at <= ${now}
      order by expires_at asc
      limit 100
    ), cleanup as (
      delete from public.rate_limit_buckets buckets
      using expired
      where buckets.key = expired.key
    ), cardinality as (
      select count(*)::integer as bucket_count
      from public.rate_limit_buckets, scope_lock
      where scope = ${options.scope}
        and expires_at > ${now}
    ), admitted as (
      select 1
      from cardinality
      where bucket_count < ${MAX_BUCKETS_PER_SCOPE}
        or exists (
          select 1 from public.rate_limit_buckets where key = ${key}
        )
    ), upserted as (
      insert into public.rate_limit_buckets (key, scope, count, expires_at, updated_at)
      select ${key}, ${options.scope}, 1, ${expiresAt}, ${now}
      from admitted
      on conflict (key) do update set
        scope = excluded.scope,
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
    )
    select count, "expiresAt" from upserted
  `;

  if (!bucket) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(options.windowMs / 1000)),
    };
  }

  return {
    allowed: bucket.count <= options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

export async function releaseRateLimitToken(
  options: Pick<RateLimitOptions, "scope" | "identifier">,
) {
  const key = createHash("sha256").update(`${options.scope}:${options.identifier}`).digest("hex");
  const now = new Date();
  await prisma.$executeRaw`
    update public.rate_limit_buckets
    set
      count = greatest(count - 1, 0),
      updated_at = ${now}
    where key = ${key}
      and expires_at > ${now}
  `;
}

export async function checkPublicRateLimit(options: PublicRateLimitOptions) {
  const source = await checkRateLimit({
    scope: `${options.scope}:source`,
    identifier: options.sourceIdentifier,
    limit: options.sourceLimit,
    windowMs: options.windowMs,
  });
  if (!source.allowed) return source;

  return checkRateLimit({
    scope: `${options.scope}:resource`,
    identifier: options.resourceIdentifier,
    limit: options.resourceLimit,
    windowMs: options.windowMs,
  });
}
