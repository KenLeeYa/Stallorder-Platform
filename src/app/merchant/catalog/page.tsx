import { notFound, redirect } from "next/navigation";
import { MerchantSetupBackLink } from "@/components/merchant-setup-back-link";
import { SharedCatalogManager } from "@/components/shared-catalog-manager";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { getEnabledTranslationLocales } from "@/lib/enabled-locales";
import { getOrganizationEnabledLocales } from "@/lib/localization-data";
import {
  getOrganizationProductNotes,
  getOrganizationReusableProductNotes,
} from "@/lib/product-note-data";
import { hasPermission } from "@/lib/rbac";
import {
  getCatalogTranslationProviderLabel,
  isCatalogTranslationConfigured,
  resolveCatalogTranslationRequestCredential,
} from "@/server/localization/catalog-translation-provider";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string; source?: string }> };

export default async function SharedCatalogPage({ searchParams }: PageProps) {
  const { organizationId, stallId, source } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) notFound();

  const authorizedStallIds = workspace.stalls.map((stall) => stall.id);
  const returnStall = workspace.stalls.find((stall) => stall.id === stallId);
  const returnStallId = returnStall?.id;
  const [catalog, noteGroups, reusableNotes, enabledLocales, aiRequestCredential, moduleFlags] = await Promise.all([
    getOrganizationCatalog(
      workspace.id,
      authorizedStallIds,
    ),
    getOrganizationProductNotes(workspace.id),
    getOrganizationReusableProductNotes(workspace.id),
    getOrganizationEnabledLocales(workspace.id, authorizedStallIds),
    resolveCatalogTranslationRequestCredential(),
    resolveResilienceFeatureFlags(["MODULE_HQ_ENABLED"], {
      organizationId: workspace.id,
      rolloutKey: workspace.id,
    }),
  ]);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      {source === "setup" ? (
        <div className="mb-4">
          <MerchantSetupBackLink organizationId={workspace.id} />
        </div>
      ) : returnStallId || source === "localization" ? (
        <div className="mb-4">
          <StallSettingsBackLink
            stallId={returnStallId}
            stallSlug={returnStall?.slug}
            organizationId={workspace.id}
            source={source}
            allowedSources={["stall-products", "localization"]}
          />
        </div>
      ) : null}
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
        initialReusableNotes={reusableNotes}
        enabledTranslationLocales={getEnabledTranslationLocales(enabledLocales)}
        aiTranslationConfigured={isCatalogTranslationConfigured(aiRequestCredential)}
        aiTranslationProviderLabel={getCatalogTranslationProviderLabel(aiRequestCredential) ?? "AI 翻譯服務"}
        versionsHref={moduleFlags.MODULE_HQ_ENABLED.enabled
          ? `/merchant/catalog/versions?organizationId=${workspace.id}`
          : undefined}
      />
    </main>
  );
}
