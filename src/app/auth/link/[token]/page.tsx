import { Link2 } from "lucide-react";
import { notFound } from "next/navigation";
import { IdentityLinkInvitationForm } from "@/components/identity-link-invitation-form";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";

type PageProps = { params: Promise<{ token: string }> };

export default async function IdentityLinkInvitationPage({ params }: PageProps) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) notFound();
  const invitation = await prisma.authIdentityLinkInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
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

  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-4 py-10">
      <section className="w-full border-y border-stone-200 bg-white py-8 sm:border sm:p-8">
        <Link2 className="h-8 w-8 text-teal-700" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold">綁定攤點通登入方式</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          請選擇管理者允許的登入方式。完成供應商驗證後，系統只會綁定至邀請指定的既有帳號，不會依電子郵件自動合併。
        </p>
        <IdentityLinkInvitationForm
          token={token}
          providers={invitation.allowedProviders}
        />
        <p className="mt-5 text-xs text-stone-500">
          邀請將於 {invitation.expiresAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 到期。
        </p>
      </section>
    </main>
  );
}
