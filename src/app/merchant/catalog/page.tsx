import { getOperationsAuthorityLabels, getOperationsReadLabels, getCatalogListLabels } from "@/server/operations-labels";
import { notFound, redirect } from "next/navigation";
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { MerchantSetupBackLink } from "@/components/merchant-setup-back-link";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { CatalogProductList } from "@/components/catalog-product-list";
import { OperationsQueryProvider } from "@/components/operations-query-provider";
import { getPaginatedOrganizationProducts } from "@/lib/catalog-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { catalogReadInputSchema, catalogReadResultSchema } from "@/lib/operations-read-contract";
import { parseOperationsPage, parseOperationsPageSize } from "@/lib/operations-pagination";
import { operationsKey } from "@/lib/operations-query";
import { createOperationsScope } from "@/server/operations-read-scope";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string; source?: string; page?: string; pageSize?: string; q?: string; active?: string; sort?: string; categoryId?: string; groupId?: string; filterStallId?: string }> };

export default async function SharedCatalogPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { organizationId, stallId, source } = query;
  const { principal, workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect('/select-organization');
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, 'MANAGE_SHARED_PRODUCTS'))) notFound();
  const authorizedStallIds = workspace.stalls.map((stall) => stall.id);
  const returnStall = workspace.stalls.find((stall) => stall.id === stallId);
  const { locale } = await getRequestAppLocale();
  const parsed = catalogReadInputSchema.safeParse({ page: parseOperationsPage(query.page), pageSize: parseOperationsPageSize(query.pageSize), q: query.q ?? '', locale, active: query.active ?? 'all', sort: query.sort ?? 'catalog', categoryId: query.categoryId, groupId: query.groupId, stallId: query.filterStallId });
  if (!parsed.success) notFound();
  const input = parsed.data;
  const scope = createOperationsScope(principal, workspace, authorizedStallIds);
  let page;
  try { page = await getPaginatedOrganizationProducts(workspace.id, authorizedStallIds, input); }
  catch (error) { if (error instanceof Error && error.message === 'OPERATIONS_NOT_FOUND') notFound(); throw error; }
  const result = catalogReadResultSchema.parse({ version: 'v1', scope, ...page });
  const client = new QueryClient();
  client.setQueryData(operationsKey(scope, 'catalog-products', input), result);
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
    {source === 'setup' ? <div className="mb-4"><MerchantSetupBackLink organizationId={workspace.id} /></div> : returnStall || source === 'localization' ? <div className="mb-4"><StallSettingsBackLink stallId={returnStall?.id} stallSlug={returnStall?.slug} organizationId={workspace.id} source={source} allowedSources={['stall-products', 'localization']} /></div> : null}
    <OperationsQueryProvider scope={scope} labels={getOperationsAuthorityLabels(locale)}><HydrationBoundary state={dehydrate(client)}><CatalogProductList initialInput={input} organizationName={workspace.name} labels={getCatalogListLabels(locale)} readLabels={getOperationsReadLabels(locale)} /></HydrationBoundary></OperationsQueryProvider>
  </main>;
}
