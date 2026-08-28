import "server-only";

import { acquireRateLimitLease } from "@/lib/rate-limit";

const STREAM_LEASE_MS = 60_000;

export async function acquireStaffSseLease(input: {
  profileId: string;
  stallId: string;
  streamKind: "orders" | "kitchen";
}) {
  const profileLease = await acquireRateLimitLease({
    scope: `staff-sse-profile:${input.streamKind}`,
    identifier: `${input.profileId}:${input.stallId}`,
    limit: 2,
    windowMs: STREAM_LEASE_MS,
  });
  if (!profileLease.allowed) return profileLease;

  const stallLease = await acquireRateLimitLease({
    scope: `staff-sse-stall:${input.streamKind}`,
    identifier: input.stallId,
    limit: 32,
    windowMs: STREAM_LEASE_MS,
  });
  if (!stallLease.allowed) {
    await profileLease.release();
    return stallLease;
  }

  let released = false;
  return {
    allowed: true as const,
    remaining: Math.min(profileLease.remaining, stallLease.remaining),
    retryAfterSeconds: Math.max(profileLease.retryAfterSeconds, stallLease.retryAfterSeconds),
    release: async () => {
      if (released) return;
      released = true;
      await Promise.all([profileLease.release(), stallLease.release()]);
    },
  };
}
