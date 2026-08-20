import "server-only";

import { Prisma } from "@prisma/client";
import { createSession, revokeAllProfileSessions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashOAuthEvidence } from "./crypto";
import type { OAuthIdentityClaims } from "./types";

type SessionEvidence = {
  deviceId: string;
  ipHash: string;
  userAgentHash: string;
};

async function availableProfileEmail(
  transaction: Prisma.TransactionClient,
  claims: OAuthIdentityClaims,
) {
  if (!claims.email || !claims.emailVerified) return null;
  const existing = await transaction.profile.findUnique({
    where: { email: claims.email },
    select: { id: true },
  });
  return existing ? null : claims.email;
}

function identityUpdateData(
  identity: {
    providerEmail: string | null;
    providerEmailVerified: boolean;
    providerDisplayName: string | null;
    providerAvatarUrl: string | null;
  },
  claims: OAuthIdentityClaims,
) {
  return {
    providerEmail: claims.email ?? identity.providerEmail,
    providerEmailVerified: claims.email
      ? claims.emailVerified
      : identity.providerEmailVerified,
    providerDisplayName: claims.displayName ?? identity.providerDisplayName,
    providerAvatarUrl: claims.avatarUrl ?? identity.providerAvatarUrl,
    providerMetadata: claims.metadata,
    lastLoginAt: new Date(),
    revokedAt: null,
  };
}

export async function completeOAuthLogin(input: {
  transactionId: string;
  claims: OAuthIdentityClaims;
  authenticatedProfileId?: string;
  requestId: string;
  sessionEvidence: SessionEvidence;
}) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id
      from public.oauth_transactions
      where id = ${input.transactionId}::uuid
      for update
    `;
    const oauthTransaction = await transaction.oAuthTransaction.findUnique({
      where: { id: input.transactionId },
    });
    if (
      !oauthTransaction
      || oauthTransaction.status !== "PROCESSING"
      || oauthTransaction.provider !== input.claims.provider
      || oauthTransaction.expiresAt <= new Date()
    ) {
      throw new Error("OAUTH_TRANSACTION_NOT_PROCESSING");
    }

    const existingIdentity = await transaction.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: input.claims.provider,
          providerSubject: input.claims.subject,
        },
      },
      include: { profile: true },
    });

    let profile;
    let linkedIdentityId: string;
    let newProfile = false;
    let organizationId: string | null = null;

    if (oauthTransaction.linkMode) {
      const invitation = oauthTransaction.invitationId
        ? await transaction.authIdentityLinkInvitation.findUnique({
            where: { id: oauthTransaction.invitationId },
          })
        : null;
      if (invitation) {
        await transaction.$queryRaw`
          select id
          from public.auth_identity_link_invitations
          where id = ${invitation.id}::uuid
          for update
        `;
        if (
          invitation.usedAt
          || invitation.revokedAt
          || invitation.expiresAt <= new Date()
          || !invitation.allowedProviders.includes(input.claims.provider)
        ) {
          throw new Error("OAUTH_IDENTITY_INVITATION_INVALID");
        }
        organizationId = invitation.organizationId;
      }
      const targetProfileId = oauthTransaction.currentProfileId ?? invitation?.profileId;
      if (!targetProfileId) throw new Error("OAUTH_IDENTITY_LINK_TARGET_MISSING");
      if (
        oauthTransaction.currentProfileId
        && input.authenticatedProfileId !== oauthTransaction.currentProfileId
      ) {
        throw new Error("OAUTH_IDENTITY_LINK_SESSION_MISMATCH");
      }
      if (existingIdentity && existingIdentity.profileId !== targetProfileId) {
        throw new Error("OAUTH_IDENTITY_ALREADY_LINKED");
      }
      const providerIdentity = await transaction.authIdentity.findUnique({
        where: {
          profileId_provider: {
            profileId: targetProfileId,
            provider: input.claims.provider,
          },
        },
      });
      if (
        providerIdentity
        && providerIdentity.providerSubject !== input.claims.subject
      ) {
        throw new Error("OAUTH_PROFILE_PROVIDER_CONFLICT");
      }
      const targetProfile = await transaction.profile.findUnique({
        where: { id: targetProfileId },
      });
      if (!targetProfile?.isActive) throw new Error("OAUTH_PROFILE_DISABLED");

      const identity = providerIdentity
        ? await transaction.authIdentity.update({
            where: { id: providerIdentity.id },
            data: identityUpdateData(providerIdentity, input.claims),
          })
        : await transaction.authIdentity.create({
            data: {
              profileId: targetProfile.id,
              provider: input.claims.provider,
              providerSubject: input.claims.subject,
              providerEmail: input.claims.email,
              providerEmailVerified: input.claims.emailVerified,
              providerDisplayName: input.claims.displayName,
              providerAvatarUrl: input.claims.avatarUrl,
              providerMetadata: input.claims.metadata,
            },
          });
      linkedIdentityId = identity.id;

      await revokeAllProfileSessions(
        targetProfile.id,
        "IDENTITY_LINKED",
        transaction,
      );
      const profileEmail = targetProfile.email
        ?? await availableProfileEmail(transaction, input.claims);
      profile = await transaction.profile.update({
        where: { id: targetProfile.id },
        data: {
          email: profileEmail,
          emailSource: targetProfile.emailSource
            ?? (profileEmail ? input.claims.provider : null),
          emailVerified: targetProfile.email
            ? targetProfile.emailVerified
            : Boolean(profileEmail && input.claims.emailVerified),
          displayName: targetProfile.displayName || input.claims.displayName || "攤點通使用者",
          avatarUrl: targetProfile.avatarUrl ?? input.claims.avatarUrl,
          authMigrationRequired: false,
          lastLoginAt: new Date(),
        },
      });
      if (invitation) {
        await transaction.authIdentityLinkInvitation.update({
          where: { id: invitation.id },
          data: {
            usedAt: new Date(),
            usedByIdentityId: identity.id,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId,
          actorProfileId: profile.id,
          action: "IDENTITY_LINKED",
          entityType: "AUTH_IDENTITY",
          entityId: identity.id,
          outcome: "SUCCESS",
          requestId: input.requestId,
          ipHash: input.sessionEvidence.ipHash,
          metadata: JSON.stringify({
            provider: input.claims.provider,
            providerSubjectHash: hashOAuthEvidence(input.claims.subject),
            invitation: Boolean(invitation),
          }),
        },
      });
    } else if (existingIdentity) {
      if (existingIdentity.revokedAt || !existingIdentity.profile.isActive) {
        throw new Error("OAUTH_IDENTITY_REVOKED");
      }
      await transaction.authIdentity.update({
        where: { id: existingIdentity.id },
        data: identityUpdateData(existingIdentity, input.claims),
      });
      linkedIdentityId = existingIdentity.id;
      const profileEmail = existingIdentity.profile.email
        ?? await availableProfileEmail(transaction, input.claims);
      profile = await transaction.profile.update({
        where: { id: existingIdentity.profileId },
        data: {
          email: profileEmail,
          emailSource: existingIdentity.profile.emailSource
            ?? (profileEmail ? input.claims.provider : null),
          emailVerified: existingIdentity.profile.email
            ? existingIdentity.profile.emailVerified
            : Boolean(profileEmail && input.claims.emailVerified),
          avatarUrl: existingIdentity.profile.avatarUrl ?? input.claims.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
    } else {
      const profileEmail = await availableProfileEmail(transaction, input.claims);
      profile = await transaction.profile.create({
        data: {
          email: profileEmail,
          emailSource: profileEmail ? input.claims.provider : null,
          emailVerified: Boolean(profileEmail && input.claims.emailVerified),
          displayName: input.claims.displayName ?? "攤點通使用者",
          avatarUrl: input.claims.avatarUrl,
          authMigrationRequired: false,
          lastLoginAt: new Date(),
        },
      });
      const identity = await transaction.authIdentity.create({
        data: {
          profileId: profile.id,
          provider: input.claims.provider,
          providerSubject: input.claims.subject,
          providerEmail: input.claims.email,
          providerEmailVerified: input.claims.emailVerified,
          providerDisplayName: input.claims.displayName,
          providerAvatarUrl: input.claims.avatarUrl,
          providerMetadata: input.claims.metadata,
        },
      });
      linkedIdentityId = identity.id;
      newProfile = true;
    }

    const session = await createSession(
      profile.id,
      input.sessionEvidence,
      transaction,
    );
    await transaction.oAuthTransaction.update({
      where: { id: oauthTransaction.id },
      data: {
        status: "CONSUMED",
        consumedAt: new Date(),
        resultSessionId: session.id,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId,
        actorProfileId: profile.id,
        action: "OAUTH_LOGIN_SUCCEEDED",
        entityType: "AUTH_IDENTITY",
        entityId: linkedIdentityId,
        outcome: "SUCCESS",
        requestId: input.requestId,
        ipHash: input.sessionEvidence.ipHash,
        metadata: JSON.stringify({
          provider: input.claims.provider,
          providerSubjectHash: hashOAuthEvidence(input.claims.subject),
          newProfile,
          linkMode: oauthTransaction.linkMode,
        }),
      },
    });

    return {
      profile,
      session,
      returnTo: oauthTransaction.returnTo,
      linkMode: oauthTransaction.linkMode,
      newProfile,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
