import "server-only";

import { NextResponse } from "next/server";
import { getMobileRequestPrincipal } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { hasPermission, type Permission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp } from "@/lib/security";
import { getMemberWorkspaceAccess } from "@/lib/workspace";
import { resolveMobileFeatureState } from "./feature-flags";

function safeClientIpHash(request: Request) {
  try {
    return hashClientIp(request);
  } catch {
    return undefined;
  }
}

export async function authorizeMobileApiRequest(request: Request) {
  const requestId = createRequestId();
  const principal = await getMobileRequestPrincipal(request);
  const featureFlags = await resolveMobileFeatureState(principal?.user.id);
  if (!featureFlags.mobileApp && !(featureFlags.localPilot && !principal)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "MOBILE_NOT_ENABLED", message: "行動版功能尚未開放。", requestId },
        { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
      ),
    };
  }

  if (!principal) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "AUTHENTICATION_REQUIRED", message: "請先登入。", requestId },
        { status: 401, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
      ),
    };
  }

  const apiLimit = await checkRateLimit({
    scope: "mobile-api",
    identifier: principal.user.id,
    limit: 300,
    windowMs: 5 * 60_000,
  });
  if (!apiLimit.allowed) {
    await recordAuditEvent({
      action: "RATE_LIMIT_HIT",
      entityType: "MOBILE_API",
      outcome: "DENIED",
      requestId,
      actorProfileId: principal.user.id,
      ipHash: safeClientIpHash(request),
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "RATE_LIMITED", message: "操作過於頻繁，請稍後再試。", requestId },
        {
          status: 429,
          headers: {
            "cache-control": "private, no-store",
            "retry-after": String(apiLimit.retryAfterSeconds),
            "x-request-id": requestId,
          },
        },
      ),
    };
  }

  if (principal.user.platformRole === "PLATFORM_ADMIN" && !featureFlags.platformAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "MOBILE_PLATFORM_ADMIN_NOT_ENABLED", message: "平台行動工作區尚未開放。", requestId },
        { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
      ),
    };
  }

  return { ok: true as const, requestId, principal, featureFlags };
}

export async function authorizeMobileStallRequest(
  request: Request,
  stallId: string,
  permission: Permission,
) {
  const authorization = await authorizeMobileApiRequest(request);
  if (!authorization.ok) return authorization;

  const { principal, requestId } = authorization;
  if (principal.user.platformRole === "PLATFORM_ADMIN") {
    await recordAuditEvent({
      action: "MOBILE_ADMIN_CONTEXT_DENIED",
      entityType: "STALL",
      entityId: stallId,
      outcome: "DENIED",
      requestId,
      actorProfileId: principal.user.id,
      ipHash: safeClientIpHash(request),
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "MERCHANT_CONTEXT_REQUIRED", message: "行動版尚未開放平台管理員商家支援情境。", requestId },
        { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
      ),
    };
  }

  const workspaces = await getMemberWorkspaceAccess(principal.user.id);
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) {
    await recordAuditEvent({
      action: "AUTHORIZATION_DENIED",
      entityType: "STALL",
      entityId: stallId,
      outcome: "DENIED",
      requestId,
      actorProfileId: principal.user.id,
      ipHash: safeClientIpHash(request),
      metadata: { client: "mobile-v1", permission },
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "RESOURCE_NOT_FOUND", message: "找不到指定資源。", requestId },
        { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
      ),
    };
  }

  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, permission))) {
    await recordAuditEvent({
      organizationId: workspace.id,
      stallId: stall.id,
      action: "AUTHORIZATION_DENIED",
      entityType: "STALL",
      entityId: stall.id,
      outcome: "DENIED",
      requestId,
      actorProfileId: principal.user.id,
      ipHash: safeClientIpHash(request),
      metadata: { client: "mobile-v1", permission, roles: roles.join(",") },
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "PERMISSION_DENIED", message: "您的角色沒有執行此操作的權限。", requestId },
        { status: 403, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
      ),
    };
  }

  return { ...authorization, workspace, stall, roles };
}
