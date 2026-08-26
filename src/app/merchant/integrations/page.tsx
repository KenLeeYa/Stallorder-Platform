import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Cable, Puzzle } from "lucide-react";
import { IntegrationSetupCenter } from "@/components/integration-setup-center";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getIntegrationSetupCenterData } from "@/server/integrations/setup-center";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantIntegrationsPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const canManageIntegrations = workspace.roles.some((role) => (
    hasPermission(role, "MANAGE_ORGANIZATION")
    || hasPermission(role, "MANAGE_DELIVERY_INTEGRATIONS")
    || hasPermission(role, "MANAGE_PAYMENT_INTEGRATIONS")
    || hasPermission(role, "MANAGE_LINE_INTEGRATION")
  ));
  if (!canManageIntegrations) notFound();

  const items = await getIntegrationSetupCenterData(workspace.id);
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-stone-950">
          <Cable className="h-7 w-7 text-teal-700" />
          整合設定中心
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
          集中查看登入、LINE、付款、外送、發票、列印與開發者整合的真實就緒狀態；未通過驗證的 Provider 不會顯示為可正式使用。
        </p>
        </div><Link href={`/merchant/enhancements?organizationId=${workspace.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800"><Puzzle className="h-4 w-4" />系統強化模組</Link></div>
      </header>
      <div className="py-6">
        <IntegrationSetupCenter organizationId={workspace.id} items={items} />
      </div>
    </main>
  );
}
