import { NextResponse } from "next/server";
import { getRequestPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRequestId } from "@/lib/security";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal) {
    return NextResponse.json(
      { authenticated: false },
      {
        status: 401,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      },
    );
  }
  const [identities, activeSessions] = await Promise.all([
    prisma.authIdentity.findMany({
      where: { profileId: principal.user.id, revokedAt: null },
      orderBy: { provider: "asc" },
      select: {
        provider: true,
        providerEmail: true,
        providerEmailVerified: true,
        lastLoginAt: true,
      },
    }),
    prisma.authSession.count({
      where: {
        profileId: principal.user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
  ]);
  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: principal.user.id,
        email: principal.user.email,
        displayName: principal.user.displayName,
      },
      identities,
      activeSessions,
    },
    {
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
