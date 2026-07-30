import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type IdentityDatabase = Pick<Prisma.TransactionClient, "authIdentity">;

export async function hasActiveOAuthIdentity(
  profileId: string,
  database: IdentityDatabase = prisma,
) {
  const count = await database.authIdentity.count({
    where: {
      profileId,
      revokedAt: null,
    },
  });
  return count > 0;
}

export async function hasVerifiedOAuthEmailIdentity(
  profileId: string,
  email: string | null,
  database: IdentityDatabase = prisma,
) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const identity = await database.authIdentity.findFirst({
    where: {
      profileId,
      providerEmail: normalizedEmail,
      providerEmailVerified: true,
      revokedAt: null,
    },
    select: { id: true },
  });
  return Boolean(identity);
}
