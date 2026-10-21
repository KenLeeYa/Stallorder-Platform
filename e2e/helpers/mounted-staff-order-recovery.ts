import { build } from "esbuild";
import type { Page } from "@playwright/test";

// Lifecycle fault injection against the actual component, not an API authorization test.
export async function mountStaffOrderRecovery(page: Page, pending: boolean) {
  const result = await build({ stdin: { contents: `import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StaffOrderComposer } from '@/components/staff-order-composer';
    const root=createRoot(document.getElementById('root'));
    window.createdOrders=[]; window.requests=[]; window.cashEvents=0;
    window.addEventListener('stallorder:cash-payment-completed',()=>window.cashEvents++);
    window.fetch=(url,init)=>new Promise(resolve=>window.requests.push({url,init,resolve}));
    const stall={id:'stall',organizationId:'org',slug:'owned',currency:'TWD'};
    window.marker={version:1,organizationId:'org',stallId:'stall',actorProfileId:'actor-a',idempotencyKey:'original-key',paymentTiming:'PAY_NOW',cash:true,draftId:null};
    if (${pending}) localStorage.setItem('stallorder_staff_order_recovery:org:stall',JSON.stringify(window.marker));
    window.renderComposer=actor=>root.render(<StaffOrderComposer key={actor} stall={stall}
      account={{role:'STAFF',profileId:actor}} modules={{dineIn:false,delivery:false,print:false,payment:false,discount:false,discountApprovalThresholdBps:8000}}
      paymentOptions={[]} discountOptions={[]} catalog={{products:[{id:'product',name:'Meal',description:'',category:'Food',price:100,imageUrl:null,isOrderDiscountEligible:true,noteGroups:[]}],tables:[],fulfillmentSlots:[],limits:{maxItemQuantity:100,maxUniqueProducts:100,maxTotalQuantity:100,maxNoteLength:1000}}}
      onCreated={order=>window.createdOrders.push(order.id)} onClose={()=>{}} />);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "locale-boundary", setup(builder) {
      builder.onResolve({ filter: /^@\/components\/operations-locale$/ }, args => ({ path: args.path, namespace: "mounted" }));
      builder.onLoad({ filter: /.*/, namespace: "mounted" }, () => ({ loader: "tsx", contents: `export const useOperationsLocale=()=>({locale:'zh-TW',t:(key,values={})=>key+' '+Object.values(values).join(' ')});` }));
    } }],
  });
  await page.route("**/__qa_mounted_pos", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("/__qa_mounted_pos"); await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.evaluate(() => (window as unknown as { renderComposer: (actor: string) => void }).renderComposer("actor-a"));
}
