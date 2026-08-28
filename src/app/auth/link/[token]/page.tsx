import { Link2 } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { IdentityLinkInvitationForm } from "@/components/identity-link-invitation-form";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getPagePrincipal } from "@/lib/auth";
import { publicMessages } from "@/lib/messages/public";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";

type PageProps = { params: Promise<{ token: string }> };

export default async function IdentityLinkInvitationPage({ params }: PageProps) {
  const [{ token }, requestLocale] = await Promise.all([params, getRequestAppLocale()]);
  const { locale } = requestLocale;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) notFound();
  const invitation = await prisma.authIdentityLinkInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      profileId: true,
      allowedProviders: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
    },
  });
  if (
    !invitation
    || invitation.usedAt
    || invitation.revokedAt
    || invitation.expiresAt <= new Date()
  ) notFound();
  const principal = await getPagePrincipal();
  if (!principal) redirect(`/login?next=${encodeURIComponent(`/auth/link/${token}`)}`);
  if (principal.user.id !== invitation.profileId) notFound();

  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-4 py-10">
      <section className="w-full border-y border-stone-200 bg-white py-8 sm:border sm:p-8">
        <Link2 className="h-8 w-8 text-teal-700" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold">{publicMessages.get(locale, "authLinkTitle")}</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {publicMessages.get(locale, "authLinkDescription")}
        </p>
        <IdentityLinkInvitationForm
          token={token}
          providers={invitation.allowedProviders}
        />
        <p className="mt-5 text-xs text-stone-500">
          {publicMessages.get(locale, "authLinkExpires", {
            time: invitation.expiresAt.toLocaleString(locale, { timeZone: "Asia/Taipei" }),
          })}
        </p>
      </section>
    </main>
  );
}
