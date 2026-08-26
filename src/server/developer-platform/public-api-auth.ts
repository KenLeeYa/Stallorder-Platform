import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId } from "@/lib/security";
import type { z } from "zod";
import type { publicApiScopeSchema } from "@/server/developer-platform/developer-contract";
import { bearerToken, publicApiKeyHash } from "@/server/developer-platform/public-api-credentials";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

type PublicApiScope = z.infer<typeof publicApiScopeSchema>;

export async function authorizePublicApiRequest(request: Request, input: {
  organizationId: string;
  requiredScope: PublicApiScope;
  stallId?: string;
}) {
  const requestId = createRequestId();
  const token = bearerToken(request);
  if (!token) return publicApiAuthError(401, "UNAUTHORIZED", requestId);
  const client = await prisma.publicApiClient.findFirst({
    where: { organizationId: input.organizationId, keyHash: publicApiKeyHash(token) },
  });
  if (
    !client
    || client.status !== "ACTIVE"
    || (client.expiresAt && client.expiresAt <= new Date())
    || !client.scopes.includes(input.requiredScope)
    || (input.stallId && client.stallIds.length > 0 && !client.stallIds.includes(input.stallId))
  ) return publicApiAuthError(401, "UNAUTHORIZED", requestId);

  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_PUBLIC_API_ENABLED"],
    { organizationId: input.organizationId, rolloutKey: client.id },
  );
  if (!flags.MODULE_PUBLIC_API_ENABLED.enabled) {
    return publicApiAuthError(403, "MODULE_DISABLED", requestId);
  }
  const limit = await checkRateLimit({
    scope: "public-api-v1",
    identifier: client.id,
    limit: 300,
    windowMs: 5 * 60_000,
  });
  if (!limit.allowed) {
    const denied = publicApiAuthError(429, "RATE_LIMITED", requestId);
    denied.response.headers.set("retry-after", String(limit.retryAfterSeconds));
    return denied;
  }
  await prisma.publicApiClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
  return { ok: true as const, client, requestId, rateLimit: limit };
}

function publicApiAuthError(status: number, code: string, requestId: string) {
  return {
    ok: false as const,
    response: NextResponse.json(
      { error: { code, message: status === 429 ? "請稍後再試。" : "無法驗證 API 存取權限。" } },
      { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    ),
  };
}
