import { NextResponse } from "next/server";
import { getRequestPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRequestId } from "@/lib/security";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal) {
    return NextResponse.json(
      { error: "請先登入。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }
  const identities = await prisma.authIdentity.findMany({
    where: { profileId: principal.user.id },
    orderBy: { provider: "asc" },
    select: {
      id: true,
      provider: true,
      providerEmail: true,
      providerEmailVerified: true,
      providerDisplayName: true,
      firstLoginAt: true,
      lastLoginAt: true,
      revokedAt: true,
    },
  });
  return NextResponse.json(
    { identities },
    {
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}
