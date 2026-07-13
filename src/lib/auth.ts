import "server-only";

import type { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createOpaqueToken, getCookieValue, hashToken } from "@/lib/security";

export const SESSION_COOKIE = "stallorder_session";
export const CSRF_COOKIE = "stallorder_csrf";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export type SessionPrincipal = {
  sessionId: string;
  csrfTokenHash: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    platformRole: UserRole | null;
  };
};

async function findPrincipal(token: string | null): Promise<SessionPrincipal | null> {
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || !session.user.isActive || session.expiresAt <= new Date()) {
    if (session) await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return {
    sessionId: session.id,
    csrfTokenHash: session.csrfTokenHash,
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      platformRole: session.user.platformRole,
    },
  };
}

export async function getRequestPrincipal(request: Request) {
  return findPrincipal(getCookieValue(request, SESSION_COOKIE));
}

export async function getPagePrincipal() {
  const cookieStore = await cookies();
  return findPrincipal(cookieStore.get(SESSION_COOKIE)?.value ?? null);
}

export async function createSession(userId: string) {
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.authSession.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      csrfTokenHash: hashToken(csrfToken),
      expiresAt,
    },
  });

  return { token, csrfToken, expiresAt };
}

export function setSessionCookies(
  response: NextResponse,
  session: { token: string; csrfToken: string; expiresAt: Date },
) {
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
}

export async function revokeRequestSession(request: Request) {
  const token = getCookieValue(request, SESSION_COOKIE);
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set(CSRF_COOKIE, "", { httpOnly: false, path: "/", maxAge: 0 });
}

export function defaultPathForRole(role: UserRole, stallSlug: string) {
  return role === "STAFF" || role === "KITCHEN" ? `/staff/${stallSlug}` : `/merchant/${stallSlug}`;
}
