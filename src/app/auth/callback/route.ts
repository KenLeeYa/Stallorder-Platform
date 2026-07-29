import { NextResponse } from "next/server";
import { createSession, setSessionCookies } from "@/lib/auth";
import { logEvent, recordAuditEvent } from "@/lib/audit";
import { resolveProjectOAuthLinkProfile } from "@/lib/oauth-linking";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { isStagingPlatformAdminBootstrapEmail } from "@/lib/platform-admin-bootstrap";
import { prisma } from "@/lib/prisma";
import { createRequestId, hashClientIp, sanitizeRedirectPath } from "@/lib/security";
import { createSupabaseAuthClient } from "@/lib/supabase-auth";
import { getDefaultWorkspacePath, getWorkspaceAccess } from "@/lib/workspace";
import { getPendingMerchantSetupPath } from "@/server/merchant-applications/merchant-setup-service";

function cleanDisplayName(value: unknown, email: string) {
  if (typeof value !== "string") return email.split("@")[0].slice(0, 80);
  const cleaned = value.replace(/[\r\n]/g, " ").trim().slice(0, 80);
  return cleaned || email.split("@")[0].slice(0, 80);
}

function cleanAvatarUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function getAuthProjectCode() {
  const value = process.env.AUTH_PROJECT_CODE?.trim().toUpperCase() || "PRIMARY";
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(value)) {
    throw new Error("AUTH_PROJECT_CODE_INVALID");
  }
  return value;
}

export async function GET(request: Request) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/auth/callback", requestId });
  const finalize = <T extends Response>(response: T) => finalizePerformanceResponse(response, timing);
  const requestUrl = new URL(request.url);
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
    : requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const requestedNext = sanitizeRedirectPath(requestUrl.searchParams.get("next"), "");
  if (!code) return finalize(NextResponse.redirect(`${appOrigin}/login?oauthError=callback-failed`));

  try {
    const supabase = await timing.measure("sessionMs", () => createSupabaseAuthClient());
    const { data, error } = await timing.measure(
      "externalApiMs",
      () => supabase.auth.exchangeCodeForSession(code),
    );
    const authUser = data.user;
    const providers = Array.isArray(authUser?.app_metadata.providers)
      ? authUser.app_metadata.providers
      : [authUser?.app_metadata.provider];
    const email = authUser?.email?.trim().toLowerCase();
    if (error || !authUser || !email || !authUser.email_confirmed_at || !providers.includes("google")) {
      throw new Error("OAUTH_IDENTITY_INVALID");
    }
    const bootstrapPlatformAdmin = isStagingPlatformAdminBootstrapEmail(email);
    const authProjectCode = getAuthProjectCode();

    const profile = await timing.measureDb(() => prisma.$transaction(async (transaction) => {
      const [projectIdentity, projectEmailIdentity, byAuthId, byEmail] = await Promise.all([
        transaction.profileAuthIdentity.findUnique({
          where: {
            authProjectCode_authUserId: {
              authProjectCode,
              authUserId: authUser.id,
            },
          },
          include: { profile: true },
        }),
        transaction.profileAuthIdentity.findFirst({
          where: {
            authProjectCode,
            provider: "GOOGLE",
            verifiedEmail: email,
          },
          include: { profile: true },
        }),
        transaction.profile.findUnique({ where: { authUserId: authUser.id } }),
        transaction.profile.findUnique({ where: { email } }),
      ]);
      if (
        projectEmailIdentity
        && projectEmailIdentity.authUserId !== authUser.id
      ) {
        throw new Error("OAUTH_ACCOUNT_CONFLICT");
      }
      const existing = resolveProjectOAuthLinkProfile(
        authUser.id,
        authProjectCode,
        projectIdentity?.profile ?? projectEmailIdentity?.profile ?? null,
        byAuthId,
        byEmail,
        {
        allowPasswordProfileLink: bootstrapPlatformAdmin,
        },
      );
      if (bootstrapPlatformAdmin && existing && existing.email.trim().toLowerCase() !== email) {
        throw new Error("OAUTH_ACCOUNT_CONFLICT");
      }

      const identityLinked = authProjectCode === "PRIMARY"
        ? existing?.authUserId === authUser.id
        : projectIdentity?.profileId === existing?.id;
      const shouldAuditBootstrap = bootstrapPlatformAdmin && (
        !existing
        || !identityLinked
        || existing.platformRole !== "PLATFORM_ADMIN"
        || !existing.isActive
      );

      const profile = existing
        ? await transaction.profile.update({
          where: { id: existing.id },
          data: {
            ...(authProjectCode === "PRIMARY" ? { authUserId: authUser.id } : {}),
            avatarUrl: existing.avatarUrl ?? cleanAvatarUrl(authUser.user_metadata.avatar_url),
            ...(bootstrapPlatformAdmin ? { isActive: true, platformRole: "PLATFORM_ADMIN" as const } : {}),
            lastLoginAt: new Date(),
          },
        })
        : await transaction.profile.create({
          data: {
            ...(authProjectCode === "PRIMARY" ? { authUserId: authUser.id } : {}),
            email,
            displayName: cleanDisplayName(
              authUser.user_metadata.full_name ?? authUser.user_metadata.name,
              email,
            ),
            avatarUrl: cleanAvatarUrl(authUser.user_metadata.avatar_url),
            ...(bootstrapPlatformAdmin ? { platformRole: "PLATFORM_ADMIN" as const } : {}),
            lastLoginAt: new Date(),
          },
        });

      await transaction.profileAuthIdentity.upsert({
        where: {
          authProjectCode_authUserId: {
            authProjectCode,
            authUserId: authUser.id,
          },
        },
        create: {
          profileId: profile.id,
          authProjectCode,
          authUserId: authUser.id,
          provider: "GOOGLE",
          verifiedEmail: email,
        },
        update: {
          profileId: profile.id,
          provider: "GOOGLE",
          verifiedEmail: email,
        },
      });

      if (shouldAuditBootstrap) {
        await transaction.auditLog.create({
          data: {
            actorProfileId: profile.id,
            action: "PLATFORM_ADMIN_BOOTSTRAPPED",
            entityType: "PROFILE",
            entityId: profile.id,
            outcome: "SUCCESS",
            requestId,
            metadata: JSON.stringify({ source: "verified-google-staging-allowlist" }),
            ...(existing ? {
              beforeJson: {
                authLinked: Boolean(existing.authUserId),
                isActive: existing.isActive,
                platformRole: existing.platformRole,
              },
            } : {}),
            afterJson: {
              authLinked: true,
              isActive: profile.isActive,
              platformRole: profile.platformRole,
            },
          },
        });
      }

      return profile;
    }), 3);

    const [workspaces, session, pendingSetupPath] = await Promise.all([
      timing.measureDb(
        () => getWorkspaceAccess(profile.id, profile.platformRole),
        3,
      ),
      timing.measure(
        "sessionMs",
        () => timing.measureDb(() => createSession(profile.id), 2),
      ),
      timing.measureDb(() => getPendingMerchantSetupPath(profile.id)),
    ]);
    const fallback = profile.platformRole === "PLATFORM_ADMIN"
      ? "/admin/billing"
      : pendingSetupPath
        ? pendingSetupPath
        : workspaces.length > 0
        ? getDefaultWorkspacePath(workspaces)
        : "/onboarding?oauth=1";
    const next = requestedNext || fallback;
    const response = NextResponse.redirect(`${appOrigin}${next}`);
    setSessionCookies(response, session);
    await timing.measureDb(() => recordAuditEvent({
      organizationId: workspaces[0]?.id,
      stallId: workspaces[0]?.stalls[0]?.id,
      actorProfileId: profile.id,
      action: "GOOGLE_LOGIN_SUCCESS",
      entityType: "AUTH",
      outcome: "SUCCESS",
      requestId,
      ipHash: hashClientIp(request),
    }));
    return finalize(response);
  } catch (error) {
    const conflict = error instanceof Error && error.message === "OAUTH_ACCOUNT_CONFLICT";
    logEvent("warn", "GOOGLE_LOGIN_FAILURE", {
      requestId,
      reason: conflict ? "ACCOUNT_CONFLICT" : "CALLBACK_FAILED",
    });
    return finalize(NextResponse.redirect(
      `${appOrigin}/login?oauthError=${conflict ? "account-conflict" : "callback-failed"}`,
    ));
  }
}
