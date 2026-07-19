import { NextResponse } from "next/server";
import { createSession, setSessionCookies } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { resolveOAuthLinkProfile } from "@/lib/oauth-linking";
import { prisma } from "@/lib/prisma";
import { createRequestId, hashClientIp, sanitizeRedirectPath } from "@/lib/security";
import { createSupabaseAuthClient } from "@/lib/supabase-auth";
import { getDefaultWorkspacePath, getWorkspaceAccess } from "@/lib/workspace";

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

export async function GET(request: Request) {
  const requestId = createRequestId();
  const requestUrl = new URL(request.url);
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
    : requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const requestedNext = sanitizeRedirectPath(requestUrl.searchParams.get("next"), "");
  if (!code) return NextResponse.redirect(`${appOrigin}/login?oauthError=callback-failed`);

  try {
    const supabase = await createSupabaseAuthClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const authUser = data.user;
    const providers = Array.isArray(authUser?.app_metadata.providers)
      ? authUser.app_metadata.providers
      : [authUser?.app_metadata.provider];
    const email = authUser?.email?.trim().toLowerCase();
    if (error || !authUser || !email || !authUser.email_confirmed_at || !providers.includes("google")) {
      throw new Error("OAUTH_IDENTITY_INVALID");
    }

    const profile = await prisma.$transaction(async (transaction) => {
      const [byAuthId, byEmail] = await Promise.all([
        transaction.profile.findUnique({ where: { authUserId: authUser.id } }),
        transaction.profile.findUnique({ where: { email } }),
      ]);
      const existing = resolveOAuthLinkProfile(authUser.id, byAuthId, byEmail);
      if (existing) {
        return transaction.profile.update({
          where: { id: existing.id },
          data: {
            authUserId: authUser.id,
            avatarUrl: existing.avatarUrl ?? cleanAvatarUrl(authUser.user_metadata.avatar_url),
            lastLoginAt: new Date(),
          },
        });
      }

      return transaction.profile.create({
        data: {
          authUserId: authUser.id,
          email,
          displayName: cleanDisplayName(
            authUser.user_metadata.full_name ?? authUser.user_metadata.name,
            email,
          ),
          avatarUrl: cleanAvatarUrl(authUser.user_metadata.avatar_url),
          lastLoginAt: new Date(),
        },
      });
    });

    const workspaces = await getWorkspaceAccess(profile.id, profile.platformRole);
    const fallback = profile.platformRole === "PLATFORM_ADMIN"
      ? "/admin/billing"
      : workspaces.length > 0
        ? getDefaultWorkspacePath(workspaces)
        : "/onboarding?oauth=1";
    const next = requestedNext || fallback;
    const session = await createSession(profile.id);
    const response = NextResponse.redirect(`${appOrigin}${next}`);
    setSessionCookies(response, session);
    await recordAuditEvent({
      organizationId: workspaces[0]?.id,
      stallId: workspaces[0]?.stalls[0]?.id,
      actorProfileId: profile.id,
      action: "GOOGLE_LOGIN_SUCCESS",
      entityType: "AUTH",
      outcome: "SUCCESS",
      requestId,
      ipHash: hashClientIp(request),
    });
    return response;
  } catch (error) {
    const conflict = error instanceof Error && error.message === "OAUTH_ACCOUNT_CONFLICT";
    return NextResponse.redirect(`${appOrigin}/login?oauthError=${conflict ? "account-conflict" : "callback-failed"}`);
  }
}
