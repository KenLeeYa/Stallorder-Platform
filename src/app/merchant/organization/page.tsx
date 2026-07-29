import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { OrganizationProfileForm } from "@/components/organization-profile-form";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function OrganizationProfilePage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"))) notFound();

  const organization = await prisma.organization.findUnique({
    where: { id: workspace.id },
    select: { businessName: true, email: true, phone: true },
  });
  if (!organization) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-3xl px-4 py-7 md:px-8">
      <Link
        href={`/merchant/setup?organizationId=${workspace.id}`}
        className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"
      >
        <ArrowLeft className="h-4 w-4" />
        返回開店設定
      </Link>
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold">
          <Building2 className="h-7 w-7 text-teal-700" />
          商家資料
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          此資料用於商家聯絡與平台通知，不會公開顯示於顧客 QR 菜單。
        </p>
      </header>
      <div className="py-7">
        <OrganizationProfileForm organizationId={workspace.id} initial={organization} />
      </div>
    </main>
  );
}
