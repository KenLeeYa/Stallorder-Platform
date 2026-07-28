import { notFound, redirect } from "next/navigation";
import { SharedCatalogManager } from "@/components/shared-catalog-manager";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { getEnabledTranslationLocales } from "@/lib/enabled-locales";
import { getOrganizationEnabledLocales } from "@/lib/localization-data";
import { getOrganizationProductNotes } from "@/lib/product-note-data";
import { hasPermission } from "@/lib/rbac";
import { isCatalogAiTranslationConfigured } from "@/server/localization/openai-catalog-translation-provider";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function SharedCatalogPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) notFound();

  const authorizedStallIds = workspace.stalls.map((stall) => stall.id);
  const [catalog, noteGroups, enabledLocales] = await Promise.all([
    getOrganizationCatalog(
      workspace.id,
      authorizedStallIds,
    ),
    getOrganizationProductNotes(workspace.id),
    getOrganizationEnabledLocales(workspace.id, authorizedStallIds),
  ]);

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
        initialNoteGroups={noteGroups}
        enabledTranslationLocales={getEnabledTranslationLocales(enabledLocales)}
        aiTranslationConfigured={isCatalogAiTranslationConfigured()}
      />
    </main>
  );
}
