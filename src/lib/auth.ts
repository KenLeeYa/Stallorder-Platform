import "server-only";

import type { Prisma } from "@prisma/client";
import type { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  createOpaqueToken,
  getCookieValue,
  getSessionDeviceId,
  hashToken,
  normalizeSessionDeviceId,
  SESSION_DEVICE_COOKIE,
  SESSION_DEVICE_MAX_AGE_SECONDS,
} from "@/lib/security";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authSessionDeviceMatches,
  canUpgradeLegacyUnboundAuthSession,
  isAuthSessionFamilyExpired,
  nextAuthSessionExpiresAt,
} from "@/lib/session-lifetime";

export const SESSION_COOKIE = "stallorder_session";
export const CSRF_COOKIE = "stallorder_csrf";
type SessionDatabase = Pick<Prisma.TransactionClient, "profile" | "authSession">;

export type SessionPrincipal = {
  sessionId: string;
  sessionExpiresAt: Date;
  csrfTokenHash: string;
  user: {
    id: string;
    authUserId: string | null;
    email: string | null;
    displayName: string;
    platformRole: UserRole | null;
  };
};

async function findPrincipal(
  token: string | null,
  presentedDeviceId: string | undefined,
): Promise<SessionPrincipal | null> {
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { profile: true },
  });

  if (!session || session.revokedAt) return null;

  const now = new Date();
  const deviceMatches = authSessionDeviceMatches(session.deviceId, presentedDeviceId);
  if (
    !session.profile.isActive
    || session.expiresAt <= now
    || session.profileSessionVersion !== session.profile.sessionVersion
    || !deviceMatches
  ) {
    const revokeReason = !session.profile.isActive
      ? "PROFILE_DISABLED"
      : session.expiresAt <= now
        ? "EXPIRED"
        : session.profileSessionVersion !== session.profile.sessionVersion
          ? "SESSION_VERSION_CHANGED"
          : "DEVICE_MISMATCH";
      await prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: now, revokeReason },
      }).catch(() => undefined);
    return null;
  }

  const firstSession = await prisma.authSession.findFirst({
    where: { rotationFamilyId: session.rotationFamilyId },
    orderBy: { issuedAt: "asc" },
    select: { issuedAt: true },
  });
  if (!firstSession || isAuthSessionFamilyExpired(firstSession.issuedAt, now.getTime())) {
    await prisma.authSession.updateMany({
      where: { rotationFamilyId: session.rotationFamilyId, revokedAt: null },
      data: { revokedAt: now, revokeReason: "ABSOLUTE_LIFETIME_REACHED" },
    }).catch(() => undefined);
    return null;
  }

  return {
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt,
    csrfTokenHash: session.csrfTokenHash,
    user: {
      id: session.profile.id,
      authUserId: session.profile.authUserId,
      email: session.profile.email,
      displayName: session.profile.displayName,
      platformRole: session.profile.platformRole,
    },
  };
}

export async function getRequestPrincipal(request: Request) {
  return findPrincipal(
    getCookieValue(request, SESSION_COOKIE),
    getSessionDeviceId(request),
  );
}

export const getPagePrincipal = cache(async function getPagePrincipal() {
  const cookieStore = await cookies();
  return findPrincipal(
    cookieStore.get(SESSION_COOKIE)?.value ?? null,
    normalizeSessionDeviceId(cookieStore.get(SESSION_DEVICE_COOKIE)?.value),
  );
});

export async function createSession(
  profileId: string,
  options: {
    deviceId: string;
    deviceLabel?: string;
    ipHash?: string;
    userAgentHash?: string;
    rotationFamilyId?: string;
    rotatedFromId?: string;
    familyExpiresAt?: Date;
  },
  database: SessionDatabase = prisma,
) {
  if (!options.deviceId) throw new Error("SESSION_DEVICE_REQUIRED");
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const now = Date.now();
  const expiresAt = new Date(Math.min(
    now + AUTH_SESSION_MAX_AGE_SECONDS * 1_000,
    options.familyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
  ));
  if (expiresAt.getTime() <= now) throw new Error("SESSION_FAMILY_EXPIRED");
  const profile = await database.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: { sessionVersion: true },
  });

  await database.authSession.deleteMany({
    where: {
      profileId,
      expiresAt: { lte: new Date(now - 30 * 24 * 60 * 60_000) },
    },
  });
  const stored = await database.authSession.create({
    data: {
      profileId,
      tokenHash: hashToken(token),
      csrfTokenHash: hashToken(csrfToken),
      expiresAt,
      profileSessionVersion: profile.sessionVersion,
      deviceId: options.deviceId,
      deviceLabel: options.deviceLabel,
      ipHash: options.ipHash,
      userAgentHash: options.userAgentHash,
      rotationFamilyId: options.rotationFamilyId,
      rotatedFromId: options.rotatedFromId,
    },
    select: { id: true },
  });

  return { id: stored.id, token, csrfToken, expiresAt, deviceId: options.deviceId };
}

export async function revokeAllProfileSessions(
  profileId: string,
  reason: string,
  database: SessionDatabase = prisma,
) {
  const now = new Date();
  await database.profile.update({
    where: { id: profileId },
    data: { sessionVersion: { increment: 1 } },
  });
  return database.authSession.updateMany({
    where: { profileId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason.slice(0, 120) },
  });
}

export async function rotateRequestSession(
  request: Request,
  evidence: {
    deviceId: string;
    deviceLabel?: string;
    ipHash?: string;
    userAgentHash?: string;
  },
) {
  const token = getCookieValue(request, SESSION_COOKIE);
  if (!token) return { status: "INVALID" as const };
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id
      from public.auth_sessions
      where token_hash = ${tokenHash}
      for update
    `;
    const current = await transaction.authSession.findUnique({
      where: { tokenHash },
      include: { profile: true },
    });
    if (!current) return { status: "INVALID" as const };

    if (current.revokedAt) {
      if (current.revokeReason === "ROTATED") {
        const now = new Date();
        await transaction.profile.update({
          where: { id: current.profileId },
          data: { sessionVersion: { increment: 1 } },
        });
        await transaction.authSession.updateMany({
          where: { rotationFamilyId: current.rotationFamilyId },
          data: {
            revokedAt: now,
            revokeReason: "REFRESH_TOKEN_REUSE",
            reuseDetectedAt: now,
          },
        });
        return { status: "REUSED" as const };
      }
      return { status: "INVALID" as const };
    }

    const deviceMatches = authSessionDeviceMatches(current.deviceId, evidence.deviceId);
    const upgradesLegacyDeviceBinding = canUpgradeLegacyUnboundAuthSession({
      storedDeviceId: current.deviceId,
      presentedDeviceId: evidence.deviceId,
      issuedAt: current.issuedAt,
      expiresAt: current.expiresAt,
    });
    if (
      !current.profile.isActive
      || current.expiresAt <= new Date()
      || current.profileSessionVersion !== current.profile.sessionVersion
      || (!deviceMatches && !upgradesLegacyDeviceBinding)
    ) {
      await transaction.authSession.update({
        where: { id: current.id },
        data: { revokedAt: new Date(), revokeReason: "REFRESH_REJECTED" },
      });
      return { status: "INVALID" as const };
    }

    const firstSession = await transaction.authSession.findFirst({
      where: { rotationFamilyId: current.rotationFamilyId },
      orderBy: { issuedAt: "asc" },
      select: { issuedAt: true },
    });
    const rotationNow = Date.now();
    if (!firstSession || isAuthSessionFamilyExpired(firstSession.issuedAt, rotationNow)) {
      await transaction.authSession.updateMany({
        where: { rotationFamilyId: current.rotationFamilyId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "ABSOLUTE_LIFETIME_REACHED" },
      });
      return { status: "INVALID" as const };
    }

    const next = await createSession(
      current.profileId,
      {
        deviceId: evidence.deviceId,
        deviceLabel: evidence.deviceLabel ?? current.deviceLabel ?? undefined,
        ipHash: evidence.ipHash ?? current.ipHash ?? undefined,
        userAgentHash: evidence.userAgentHash ?? current.userAgentHash ?? undefined,
        rotationFamilyId: current.rotationFamilyId,
        rotatedFromId: current.id,
        familyExpiresAt: nextAuthSessionExpiresAt(firstSession.issuedAt, rotationNow),
      },
      transaction,
    );
    await transaction.authSession.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), revokeReason: "ROTATED" },
    });
    return { status: "ROTATED" as const, session: next, profileId: current.profileId };
  });
}

export function setSessionCookies(
  response: NextResponse,
  session: { token: string; csrfToken: string; expiresAt: Date; deviceId: string },
  deviceId = session.deviceId,
) {
  if (!deviceId || deviceId !== session.deviceId) throw new Error("SESSION_DEVICE_MISMATCH");
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  response.cookies.set(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  response.cookies.set(SESSION_DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DEVICE_MAX_AGE_SECONDS,
  });
}

export async function revokeRequestSession(request: Request) {
  const token = getCookieValue(request, SESSION_COOKIE);
  if (token) {
    await prisma.$transaction(async (transaction) => {
      const current = await transaction.authSession.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { rotationFamilyId: true },
      });
      if (!current) return;
      await transaction.authSession.updateMany({
        where: { rotationFamilyId: current.rotationFamilyId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "LOGOUT" },
      });
    });
  }
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set(CSRF_COOKIE, "", { httpOnly: false, path: "/", maxAge: 0 });
}

export function defaultPathForRole(role: UserRole, stallSlug: string) {
  if (role === "PLATFORM_ADMIN") return "/admin/billing";
  if (role === "KITCHEN") return `/kitchen?stall=${encodeURIComponent(stallSlug)}`;
  if (role === "STAFF") return `/staff/${stallSlug}`;
  if (role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN" || role === "FINANCE_VIEWER") {
    return "/merchant/dashboard";
  }
  return `/merchant/${stallSlug}`;
}
