import { notFound, redirect } from "next/navigation";
import { AcceptInvitation } from "@/components/accept-invitation";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getPagePrincipal } from "@/lib/auth";
import { publicMessages } from "@/lib/messages/public";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";
import { hasActiveOAuthIdentity } from "@/server/auth/oauth/profile-identity";

type PageProps = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: PageProps) {
  const [{ token }, requestLocale] = await Promise.all([params, getRequestAppLocale()]);
  const { locale } = requestLocale;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) notFound();

  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: true, stall: true },
  });
  if (!invitation || invitation.status !== "PENDING") notFound();

  const principal = await getPagePrincipal();
  if (!principal) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const expired = invitation.expiresAt <= new Date();
  const emailMatches = principal.user.email?.trim().toLowerCase() === invitation.email;
  const hasOAuthIdentity = await hasActiveOAuthIdentity(principal.user.id);
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-4 py-10">
      <section className="w-full border-y border-stone-200 py-8">
        <p className="text-sm font-semibold text-teal-800">{publicMessages.get(locale, "inviteEyebrow")}</p>
        <h1 className="mt-2 text-3xl font-semibold">{publicMessages.get(locale, "inviteTitle", { organization: invitation.organization.businessName })}</h1>
        <dl className="mt-6 space-y-3 text-sm">
          <div>
            <dt className="text-stone-500">{publicMessages.get(locale, "inviteRole")}</dt>
            <dd className="mt-1 font-semibold">{publicMessages.get(locale, roleMessageKeys[invitation.role])}</dd>
          </div>
          {invitation.stall ? (
            <div>
              <dt className="text-stone-500">{publicMessages.get(locale, "inviteStall")}</dt>
              <dd className="mt-1 font-semibold">{invitation.stall.name}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-stone-500">{publicMessages.get(locale, "inviteEmail")}</dt>
            <dd className="mt-1 break-all font-semibold">{invitation.email}</dd>
          </div>
        </dl>
        {expired ? (
          <p role="alert" className="mt-6 text-sm text-red-700">
            {publicMessages.get(locale, "inviteExpired")}
          </p>
        ) : !principal.user.authUserId && !hasOAuthIdentity ? (
          <p role="alert" className="mt-6 text-sm text-red-700">
            {publicMessages.get(locale, "inviteVerifiedAccountRequired")}
          </p>
        ) : !emailMatches ? (
          <p role="alert" className="mt-6 text-sm text-red-700">
            {publicMessages.get(locale, "inviteEmailMismatch")}
          </p>
        ) : (
          <AcceptInvitation token={token} />
        )}
      </section>
    </main>
  );
}

const roleMessageKeys = {
  PLATFORM_ADMIN: "rolePlatformAdmin",
  MERCHANT_OWNER: "roleMerchantOwner",
  MERCHANT_MANAGER: "roleMerchantManager",
  ORGANIZATION_OWNER: "roleOrganizationOwner",
  ORGANIZATION_ADMIN: "roleOrganizationAdmin",
  FINANCE_VIEWER: "roleFinanceViewer",
  STALL_MANAGER: "roleStallManager",
  STAFF: "roleStaff",
  KITCHEN: "roleKitchen",
} as const;
