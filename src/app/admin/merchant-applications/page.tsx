import { getOperationsAuthorityLabels, getOperationsReadLabels } from "@/server/operations-labels";
import { notFound } from 'next/navigation';
import { QueryClient, dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { requirePlatformAdminPage } from '@/lib/authorization';
import { applicationReadInputSchema, applicationReadResultSchema } from '@/lib/operations-read-contract';
import { operationsKey } from '@/lib/operations-query';
import { createOperationsScope } from '@/server/operations-read-scope';
import { listPaginatedMerchantApplications } from '@/server/merchant-applications/merchant-application-admin-service';
import { OperationsQueryProvider } from '@/components/operations-query-provider';
import { AdminMerchantApplicationTable } from '@/components/admin-merchant-application-table';
import { getRequestAppLocale } from '@/lib/app-locale-server';
import { createAdminTranslator } from '@/lib/messages/admin';

export default async function MerchantApplicationsAdminPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const principal = await requirePlatformAdminPage('/admin/merchant-applications');
  const query = await searchParams;
  const parsed = applicationReadInputSchema.safeParse(Object.fromEntries(Object.entries(query).filter(([,v]) => v !== '' && v !== undefined)));
  if (!parsed.success) notFound();
  const input = parsed.data;
  const scope = createOperationsScope(principal);
  const result = applicationReadResultSchema.parse({ version: 'v1', scope, ...await listPaginatedMerchantApplications(input) });
  const client = new QueryClient(); client.setQueryData(operationsKey(scope,'merchant-applications',input),result);
  const { locale } = await getRequestAppLocale(); const m = createAdminTranslator(locale);
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8"><header><h1 className="text-3xl font-semibold">{m('Merchant application review')}</h1><p className="mt-2 text-sm text-stone-600">{m('All applications require manual approval. Submission does not create a merchant, and QR remains paused after approval.')}</p></header><OperationsQueryProvider scope={scope} labels={getOperationsAuthorityLabels(locale)}><HydrationBoundary state={dehydrate(client)}><AdminMerchantApplicationTable initialInput={input} readLabels={getOperationsReadLabels(locale)} /></HydrationBoundary></OperationsQueryProvider></main>;
}
