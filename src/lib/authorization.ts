import "server-only";

import type { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getPagePrincipal, getRequestPrincipal, type SessionPrincipal } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasPermission, resolvePrimaryRole, type Permission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp } from "@/lib/security";

export async function findStallAccess(principal: SessionPrincipal, stallSlug: string) {
  const stall = await prisma.stall.findFirst({
    where: {
      slug: stallSlug,
      isActive: true,
      organization: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    },
    include: { organization: true },
  });
  if (!stall) return null;

  if (principal.user.platformRole === "PLATFORM_ADMIN") {
    return { stall, role: "PLATFORM_ADMIN" as UserRole, roles: ["PLATFORM_ADMIN" as UserRole] };
  }

  const [organizationMemberships, stallMemberships] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: {
        organizationId: stall.organizationId,
        profileId: principal.user.id,
        isActive: true,
      },
    }),
    prisma.stallMembership.findMany({
      where: {
        organizationId: stall.organizationId,
        profileId: principal.user.id,
        stallId: stall.id,
        isActive: true,
      },
    }),
  ]);

  const roles = [
    ...organizationMemberships
      .filter((membership) => (
        membership.role === "ORGANIZATION_OWNER"
        || membership.allStalls
        || stallMemberships.length > 0
      ))
      .map((membership) => membership.role),
    ...stallMemberships.map((membership) => membership.role),
  ];
  const role = resolvePrimaryRole(roles);

  return role ? { stall, role, roles } : null;
}

export async function requirePagePermission(stallSlug: string, permission: Permission, returnPath: string) {
  const principal = await getPagePrincipal();
  if (!principal) redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  const access = await findStallAccess(principal, stallSlug);
  if (!access || !access.roles.some((role) => hasPermission(role, permission))) notFound();

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
      actorProfileId: principal.user.id,
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
      actorProfileId: principal.user.id,
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

  if (!access.roles.some((role) => hasPermission(role, permission))) {
    await recordAuditEvent({
      action: "AUTHORIZATION_DENIED",
      entityType: "STALL",
      entityId: access.stall.id,
      outcome: "DENIED",
      requestId,
      stallId: access.stall.id,
      actorProfileId: principal.user.id,
      ipHash: hashClientIp(request),
      metadata: { permission, role: access.roles.join(",") },
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
