import "server-only";

import type { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getPagePrincipal, getRequestPrincipal, type SessionPrincipal } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasPermission, type Permission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp } from "@/lib/security";

async function findStallAccess(principal: SessionPrincipal, stallSlug: string) {
  if (principal.user.platformRole === "PLATFORM_ADMIN") {
    const stall = await prisma.stall.findFirst({
      where: { slug: stallSlug, isActive: true },
      include: { merchant: true },
    });
    return stall ? { stall, role: "PLATFORM_ADMIN" as UserRole } : null;
  }

  const membership = await prisma.stallMembership.findFirst({
    where: {
      userId: principal.user.id,
      isActive: true,
      stall: {
        slug: stallSlug,
        isActive: true,
        merchant: { status: { in: ["TRIALING", "ACTIVE"] } },
      },
    },
    include: { stall: { include: { merchant: true } } },
  });

  return membership ? { stall: membership.stall, role: membership.role } : null;
}

export async function requirePagePermission(stallSlug: string, permission: Permission, returnPath: string) {
  const principal = await getPagePrincipal();
  if (!principal) redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  const access = await findStallAccess(principal, stallSlug);
  if (!access || !hasPermission(access.role, permission)) notFound();

  return { principal, ...access };
}

export async function authorizeApiRequest(request: Request, stallSlug: string, permission: Permission) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "請先登入。" },
        { status: 401, headers: { "x-request-id": requestId } },
      ),
    };
  }

  const apiLimit = await checkRateLimit({
    scope: "authenticated-api",
    identifier: principal.user.id,
    limit: 300,
    windowMs: 5 * 60_000,
  });
  if (!apiLimit.allowed) {
    await recordAuditEvent({
      action: "RATE_LIMIT_HIT",
      entityType: "AUTHENTICATED_API",
      outcome: "DENIED",
      requestId,
      actorUserId: principal.user.id,
      ipHash: hashClientIp(request),
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "操作過於頻繁，請稍後再試。" },
        {
          status: 429,
          headers: { "retry-after": String(apiLimit.retryAfterSeconds), "x-request-id": requestId },
        },
      ),
    };
  }

  const access = await findStallAccess(principal, stallSlug);
  if (!access) {
    await recordAuditEvent({
      action: "AUTHORIZATION_DENIED",
      entityType: "STALL",
      outcome: "DENIED",
      requestId,
      actorUserId: principal.user.id,
      ipHash: hashClientIp(request),
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "找不到指定資源。" },
        { status: 404, headers: { "x-request-id": requestId } },
      ),
    };
  }

  if (!hasPermission(access.role, permission)) {
    await recordAuditEvent({
      action: "AUTHORIZATION_DENIED",
      entityType: "STALL",
      entityId: access.stall.id,
      outcome: "DENIED",
      requestId,
      stallId: access.stall.id,
      actorUserId: principal.user.id,
      ipHash: hashClientIp(request),
      metadata: { permission, role: access.role },
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "您的角色沒有執行此操作的權限。" },
        { status: 403, headers: { "x-request-id": requestId } },
      ),
    };
  }

  return { ok: true as const, requestId, principal, ...access };
}
