import { build } from "esbuild";
import type { Page } from "@playwright/test";

// Actual shared consumer with in-memory permit/storage and PWA connectivity boundaries.
export async function mountOfflineRecovery(page: Page) {
  const result = await build({ stdin: { contents: `import React from 'react';
    import { createRoot } from 'react-dom/client'; import { OfflinePosRecovery } from '@/components/offline-pos-recovery';
    const root=createRoot(document.getElementById('root')); window.requests=[];
    window.fetch=(url,init)=>{window.requests.push({url,method:init?.method});return Promise.resolve(new Response('{}'));};
    Object.defineProperty(navigator,'onLine',{get:()=>window.testOnline});
    window.renderRecovery=online=>{window.testOnline=online;root.render(<OfflinePosRecovery/>);};`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "offline-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(@\/offline\/offline-operations|@\/components\/(operations-locale|pwa-runtime|offline-queue-status|contextual-back-button)|next\/link)$/ }, args => ({ path: args.path, namespace: "offline-mount" }));
      builder.onLoad({ filter: /.*/, namespace: "offline-mount" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path.endsWith('operations-locale') ? `const value={locale:'zh-TW',t:(key)=>key}; export const useOperationsLocale=()=>value;` :
        args.path.endsWith('pwa-runtime') ? `export const usePwaRuntime=()=>({online:window.testOnline});` :
        args.path.endsWith('offline-queue-status') ? `export const OfflineQueueStatus=()=>null;` :
        args.path.endsWith('contextual-back-button') ? `export const ContextualBackButton=({fallbackHref,children,...rest})=><a href={fallbackHref} {...rest}>{children}</a>;` :
        args.path==='next/link' ? `export default function Link(props){return <a {...props}/>;}` :
        `export const getOfflineRecoveryWorkspaces=async()=>[{stall:{id:'stall',organizationId:'org',slug:'owned',name:'Owned',currency:'TWD'},catalog:{products:[{id:'product',name:'Meal',description:'',category:'Food',price:100,imageUrl:null,isOrderDiscountEligible:true,noteGroups:[]}],tables:[],fulfillmentSlots:[],limits:{maxItemQuantity:100,maxUniqueProducts:100,maxTotalQuantity:100,maxNoteLength:1000}},account:{role:'STAFF'},modules:{dineIn:false,delivery:false,print:false,payment:false,discount:false,discountApprovalThresholdBps:0},paymentOptions:[],permitExpiresAt:'2099-01-01T00:00:00Z',menuExpiresAt:'2099-01-01T00:00:00Z',storageClass:'PERSISTENT',canCreateOrder:true}]; export const listUnsynchronizedOfflineOrders=async()=>[];export const queueOfflinePrintJob=async()=>{};export const transitionOfflineOrder=async()=>{};export const createOfflineOrder=async()=>{throw new Error('UNEXPECTED_OFFLINE_WRITE')};`
      }));
    } }],
  });
  await page.route("**/__qa_offline_recovery", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.route("**/staff/owned", route => route.fulfill({ contentType: "text/html", body: '<h1>Authenticated staff entry</h1>' }));
  await page.goto("/__qa_offline_recovery"); await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.evaluate(() => (window as unknown as { renderRecovery: (online: boolean) => void }).renderRecovery(true));
}
