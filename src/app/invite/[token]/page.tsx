import { notFound, redirect } from "next/navigation";
import { AcceptInvitation } from "@/components/accept-invitation";
import { getPagePrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleLabels } from "@/lib/rbac";
import { hashToken } from "@/lib/security";
import { hasActiveOAuthIdentity } from "@/server/auth/oauth/profile-identity";

type PageProps = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: PageProps) {
  const { token } = await params;
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
        <p className="text-sm font-semibold text-teal-800">StallOrder 團隊邀請</p>
        <h1 className="mt-2 text-3xl font-semibold">加入 {invitation.organization.businessName}</h1>
        <dl className="mt-6 space-y-3 text-sm">
          <div>
            <dt className="text-stone-500">角色</dt>
            <dd className="mt-1 font-semibold">{roleLabels[invitation.role]}</dd>
          </div>
          {invitation.stall ? (
            <div>
              <dt className="text-stone-500">攤位</dt>
              <dd className="mt-1 font-semibold">{invitation.stall.name}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-stone-500">受邀 Email</dt>
            <dd className="mt-1 break-all font-semibold">{invitation.email}</dd>
          </div>
        </dl>
        {expired ? (
          <p role="alert" className="mt-6 text-sm text-red-700">
            此邀請已過期，請聯絡管理員重新邀請。
          </p>
        ) : !principal.user.authUserId && !hasOAuthIdentity ? (
          <p role="alert" className="mt-6 text-sm text-red-700">
            請登出並改用受邀且已驗證電子郵件的帳號登入。
          </p>
        ) : !emailMatches ? (
          <p role="alert" className="mt-6 text-sm text-red-700">
            目前登入帳號的 Email 與邀請不符。
          </p>
        ) : (
          <AcceptInvitation token={token} />
        )}
      </section>
    </main>
  );
}
