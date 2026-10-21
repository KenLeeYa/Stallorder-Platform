import { getCatalogListLabels, getOperationsReadLabels, getHistoryListLabels } from "@/server/operations-labels";
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {APP_LOCALES} from '@/lib/app-locale';
import {createReportTranslator} from '@/lib/messages/reports';
import {getMerchantMessage} from '@/lib/messages/merchant';
import {operationsKey,OperationsReadError} from '@/lib/operations-query';
import {CatalogProductList} from './catalog-product-list';
import {OrderHistoryTable} from './order-history-table';
import {OperationsReadFeedback} from './operations-read-feedback';
const {scope}=vi.hoisted(()=>({scope:{version:'v1',environment:'local',principalKey:'a'.repeat(64),sessionEpoch:'b'.repeat(64),permissionRevision:'c'.repeat(64),context:{kind:'organization',organizationId:'00000000-0000-4000-8000-000000000001',stallIds:['00000000-0000-4000-8000-000000000002'] as string[]}} as const}));
vi.mock('server-only',()=>({}));
vi.mock('./operations-query-provider',()=>({useOperationsAuthority:()=>({scope,current:()=>true,deny:vi.fn(),capture:()=>()=>true})}));
describe('actual affected operations consumers retain all six locales',()=>{
it.each(APP_LOCALES)('%s renders catalog, history status/fulfillment and feedback with existing locale owners',locale=>{
 const client=new QueryClient();const catalog={page:1,pageSize:5 as const,q:'',locale,active:'all' as const,sort:'catalog' as const},history={organizationId:scope.context.organizationId,stallIds:[...scope.context.stallIds],dateFrom:'2026-09-30',dateTo:'2026-09-30',page:1,pageSize:5 as const,sort:'createdAtDesc' as const};
 const pagination={page:1,pageSize:5,total:1,totalPages:1,firstItem:1,lastItem:1};
 client.setQueryData(operationsKey(scope,'catalog-products',catalog),{version:'v1',scope,pagination,rows:[{id:'00000000-0000-4000-8000-000000000003',localizedName:'Synthetic product',defaultPrice:50,isActive:true}]});
 client.setQueryData(operationsKey(scope,'order-history',history),{version:'v1',scope,pagination,rows:[{id:'00000000-0000-4000-8000-000000000004',orderNo:'TEST',stall:{id:scope.context.stallIds[0],name:'Synthetic stall'},createdAt:'2026-09-30T04:00:00Z',status:'COMPLETED',fulfillmentType:'TAKEOUT',total:50}]});
 const html=renderToStaticMarkup(<QueryClientProvider client={client}><CatalogProductList initialInput={catalog} organizationName="Synthetic" labels={getCatalogListLabels(locale)} readLabels={getOperationsReadLabels(locale)}/><OrderHistoryTable initialInput={history} locale={locale} currency="TWD" labels={getHistoryListLabels(locale)} readLabels={getOperationsReadLabels(locale)}/><OperationsReadFeedback labels={getOperationsReadLabels(locale)} locale={locale} error={new OperationsReadError(429,'Synthetic',Date.now()+120000)} updatedAt={0} onRetry={()=>{}}/></QueryClientProvider>);
 const t=createReportTranslator(locale);for(const label of [getMerchantMessage(locale,'搜尋商品'),getMerchantMessage(locale,'完整管理／新增商品'),getMerchantMessage(locale,'重試'),t('reports.orders.status.completed'),t('reports.orders.fulfillment.takeout')])expect(html).toContain(label);expect(html).not.toContain('>COMPLETED<');client.clear();
});});

it('actual affected client entries exclude the aggregate merchant locale runtime',async()=>{
 const {build}=await import('esbuild'),path=await import('node:path'),fs=await import('node:fs');
 const entries=['operations-query-provider','operations-read-feedback','catalog-product-list','order-history-table'];
 const preimage=process.env.AWESOME_QA_GRAPH_PREIMAGE==='1';
 const plugins=preimage?[{name:'captured-round2-client-preimages',setup(b:import('esbuild').PluginBuild){b.onLoad({filter:/src[\\/]components[\\/](operations-query-provider|operations-read-feedback|catalog-product-list|order-history-table)\.tsx$/},args=>({contents:fs.readFileSync(path.resolve('.superpowers/sdd/2026-10-01-awesome-optimization/batch-2/repair-2/before/src__components__'+path.basename(args.path)+'.before'),'utf8'),loader:'tsx'}));}}]:[];
 const graph=[];
 for(const entry of entries){const result=await build({entryPoints:['src/components/'+entry+'.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',packages:'external',alias:{'@':path.resolve('src')},plugins});const inputs=Object.keys(result.metafile!.inputs);graph.push({entry,inputs});expect(inputs.some(p=>p.endsWith('src/lib/messages/merchant.ts'))).toBe(false);}
 if(process.env.AWESOME_QA_GRAPH_RECEIPT)fs.writeFileSync(process.env.AWESOME_QA_GRAPH_RECEIPT,JSON.stringify({preimage,graph},null,2)+'\n');
});
