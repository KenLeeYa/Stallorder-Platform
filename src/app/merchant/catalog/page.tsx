import { notFound, redirect } from "next/navigation";
import { SharedCatalogManager } from "@/components/shared-catalog-manager";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function SharedCatalogPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) notFound();

  const catalog = await getOrganizationCatalog(
    workspace.id,
    workspace.stalls.map((stall) => stall.id),
  );

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <SharedCatalogManager
        organizationId={workspace.id}
        currency={workspace.defaultCurrency}
        stalls={workspace.stalls.map((stall) => ({
          id: stall.id,
          name: stall.name,
          isActive: stall.isActive,
        }))}
        initialCatalog={catalog}
      />
    </main>
  );
}
