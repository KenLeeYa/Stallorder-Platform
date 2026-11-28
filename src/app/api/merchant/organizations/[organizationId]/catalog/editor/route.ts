import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { hasPermission } from "@/lib/rbac";
import { getEnabledTranslationLocales } from "@/lib/enabled-locales";
import { getOrganizationEnabledLocales } from "@/lib/localization-data";
import { getOrganizationProductNotes, getOrganizationReusableProductNotes } from "@/lib/product-note-data";
import { getCatalogTranslationProviderLabel, isCatalogTranslationConfigured, resolveCatalogTranslationRequestCredential } from "@/server/localization/catalog-translation-provider";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";
import { createOperationsScope } from "@/server/operations-read-scope";
import { catalogEditorResultSchema } from "@/lib/operations-read-contract";
import { operationsAuthorizationFailure, operationsReadFailure, operationsReadResponse } from "@/server/operations-read-response";

export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const authorized = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SHARED_PRODUCTS", true);
  if (!authorized.ok) return operationsAuthorizationFailure(authorized.response);
  if (!authorized.workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) return operationsReadFailure(403, authorized.requestId);
  if (new URL(request.url).search) return operationsReadFailure(400, authorized.requestId);
  try {
    const ids = authorized.authorizedStallIds;
    const [catalog, noteGroups, reusableNotes, locales, credential, flags] = await Promise.all([getOrganizationCatalog(organizationId, ids), getOrganizationProductNotes(organizationId), getOrganizationReusableProductNotes(organizationId), getOrganizationEnabledLocales(organizationId, ids), resolveCatalogTranslationRequestCredential(), resolveResilienceFeatureFlags(["MODULE_HQ_ENABLED"], { organizationId, rolloutKey: organizationId })]);
    return operationsReadResponse(catalogEditorResultSchema.parse({ version: "v1", scope: createOperationsScope(authorized.principal, authorized.workspace, ids), editor: { organizationId, operatingMode: authorized.workspace.operatingMode, currency: authorized.workspace.defaultCurrency, stalls: authorized.workspace.stalls.filter((s) => ids.includes(s.id)).map(({ id, name, isActive }) => ({ id, name, isActive })), initialCatalog: catalog, initialNoteGroups: noteGroups, initialReusableNotes: reusableNotes, enabledTranslationLocales: getEnabledTranslationLocales(locales), aiTranslationConfigured: isCatalogTranslationConfigured(credential), aiTranslationProviderLabel: getCatalogTranslationProviderLabel(credential) ?? "AI 翻譯服務", versionsHref: flags.MODULE_HQ_ENABLED.enabled ? `/merchant/catalog/versions?organizationId=${organizationId}` : undefined } }), authorized.requestId);
  } catch { return operationsReadFailure(500, authorized.requestId); }
}
