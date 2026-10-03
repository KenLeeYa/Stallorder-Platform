import { getOperationsAuthorityLabels, getOperationsReadLabels, getHistoryListLabels } from "@/server/operations-labels";
import { notFound } from "next/navigation";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { OrderHistoryTable } from "@/components/order-history-table";
import { OperationsQueryProvider } from "@/components/operations-query-provider";
import { historyReadInputSchema, historyReadResultSchema } from "@/lib/operations-read-contract";
import { operationsKey } from "@/lib/operations-query";
import { createOperationsScope } from "@/server/operations-read-scope";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { createReportTranslator } from "@/lib/messages/reports";
import { parseOperationsPage, parseOperationsPageSize } from "@/lib/operations-pagination";
import { getOperationsOrderHistoryPage } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string; page?: string; pageSize?: string; sort?: string }> };

export default async function OrderHistoryReportPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportTranslator(locale);
  const query = await searchParams;
  const scope = await requireReportScope(query);
  const parsed = historyReadInputSchema.safeParse({ organizationId: scope.workspace.id, stallIds: scope.stalls.map((stall) => stall.id).sort(), dateFrom: scope.dateFrom, dateTo: scope.dateTo, page: parseOperationsPage(query.page), pageSize: parseOperationsPageSize(query.pageSize), sort: query.sort ?? 'createdAtDesc' });
  if (!parsed.success) notFound();
  const input = parsed.data;
  const clientScope = createOperationsScope(scope.principal, scope.workspace, input.stallIds);
  const result = historyReadResultSchema.parse({ version: 'v1', scope: clientScope, ...await getOperationsOrderHistoryPage(input.organizationId, input.stallIds, input.dateFrom, input.dateTo, input) });
  const client = new QueryClient(); client.setQueryData(operationsKey(clientScope, 'order-history', input), result);

  return <main data-testid="report-orders" className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">{t("reports.eyebrow")}</p><h1 className="mt-1 text-3xl font-semibold">{t("reports.orders.title")}</h1></div>
    <ReportNavigation organizationId={scope.workspace.id} active="orders" />
    <ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} multiStallMode={scope.workspace.operatingMode === "MULTI_STALL"} pageSize={input.pageSize} />
    <OperationsQueryProvider scope={clientScope} labels={getOperationsAuthorityLabels(locale)}><HydrationBoundary state={dehydrate(client)}><OrderHistoryTable initialInput={input} locale={locale} currency={scope.workspace.defaultCurrency} labels={getHistoryListLabels(locale)} readLabels={getOperationsReadLabels(locale)} /></HydrationBoundary></OperationsQueryProvider>
  </main>;
}
