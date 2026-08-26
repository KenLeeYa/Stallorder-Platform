import { notFound, redirect } from "next/navigation";
import { GitBranch } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { CatalogVersionManager } from "@/components/catalog-version-manager";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { listCatalogVersions } from "@/server/catalog-versions/catalog-version-service";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function CatalogVersionsPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) notFound();
  const flags = await resolveResilienceFeatureFlags(["MODULE_HQ_ENABLED"], {
    organizationId: workspace.id,
    rolloutKey: workspace.id,
  });
  if (!flags.MODULE_HQ_ENABLED.enabled) notFound();

  const versions = await listCatalogVersions(workspace.id);
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref={`/merchant/catalog?organizationId=${workspace.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold text-stone-800 hover:border-teal-600 hover:bg-teal-50">
        返回共用商品
      </ContextualBackButton>
      <header className="mt-5 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-stone-950">
          <GitBranch className="h-7 w-7 text-teal-700" />
          菜單版本與發布
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">建立可審核、可排程、可回滾的菜單快照；通路覆寫與正式發布會在各 Provider 通過驗證後才開放。</p>
      </header>
      <div className="py-6">
        <CatalogVersionManager organizationId={workspace.id} initialVersions={versions} />
      </div>
    </main>
  );
}
