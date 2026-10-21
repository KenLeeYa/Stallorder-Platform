import { chromium, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { assertResponsiveQaTarget } from '../../responsive-qa-target.mjs';
import { readResponsiveBuildProvenance } from '../../responsive-build-provenance.mjs';
loadEnvFile('.env.local'); assertResponsiveQaTarget(process.env);
const phase=process.argv[2]; if(!['before','after'].includes(phase))throw Error('AWESOME_MEASURE_PHASE_INVALID');
const directory='.superpowers/sdd/2026-10-01-awesome-optimization/batch-2';
const fixture=JSON.parse(readFileSync(`${directory}/fixture-freeze.json`));
const manifest=JSON.parse(readFileSync('.next/responsive-build-provenance.json'));
const source=readResponsiveBuildProvenance({expectedSourceSha256:manifest.sourceAfter.sourceSha256});
const origin='http://127.0.0.1:3026';
const cases=[{name:'catalog',role:'owner',path:`/merchant/catalog?organizationId=${fixture.organizations[0]}`,marker:'awesome-b1'},
 {name:'history',role:'owner',path:`/merchant/reports/orders?organizationId=${fixture.organizations[0]}&dateFrom=2026-09-30&dateTo=2026-09-30`,marker:'AWB1-'},
 {name:'applications',role:'admin',path:'/admin/merchant-applications?status=PENDING_REVIEW',marker:'商家申請審核'}];
const result={phase,source:{head:source.head,tree:source.tree,buildId:source.buildId,sourceSha256:source.sourceAfter.sourceSha256,artifactSha256:source.artifactSha256},fixtureDigest:fixture.digest,fixtureCounts:fixture.counts,measurementSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'),startedAt:new Date().toISOString(),transport:{before:'Actual authenticated document/RSC reads at existing user-visible entrance; no preexisting paged API on these surfaces.',after:'Same document entrance; new bounded API follow-up separately reported; transport is not equivalent.'},queryCount:'UNAVAILABLE',routes:{},diagnostics:[]};
const save=()=>writeFileSync(`${directory}/${phase}-metrics.json`,JSON.stringify(result,null,2)+'\n');
const browser=await chromium.launch(); const options={baseURL:origin,locale:'zh-TW',timezoneId:'Asia/Taipei',serviceWorkers:'block',extraHTTPHeaders:{'x-vercel-forwarded-for':'203.0.113.10','cf-connecting-ip':'203.0.113.10'}};
const states={};
try {
 for(const role of ['owner','admin']){const c=await browser.newContext(options);const p=await c.newPage();await p.goto('/login');await p.getByRole('button',{name:'使用電子郵件與密碼登入',exact:true}).click();await p.getByLabel('電子郵件').fill(role==='owner'?'owner@stallorder.test':'platform.admin@stallorder.test');await p.getByLabel('密碼').fill('StallOrderDemo!2026');await p.getByRole('button',{name:'登入',exact:true}).click();await p.waitForURL(u=>!u.pathname.endsWith('/login'));states[role]=await c.storageState();await c.close();}
 for(const item of cases){const data={documentSamples:[],documentWarmups:[],freshContexts:[],jsGzipBytes:[],total:'UNAVAILABLE'};result.routes[item.name]=data;save();
  const c=await browser.newContext({...options,storageState:states[item.role]}); const warmPage=await c.newPage();await warmPage.goto(item.path);await expect(warmPage.locator('main').first()).toContainText(item.marker);
  for(let n=0;n<35;n++){const sample=await warmPage.evaluate(async path=>{const start=performance.now();const r=await fetch(path,{credentials:'same-origin',cache:'no-store'});const text=await r.text();return {status:r.status,ms:performance.now()-start,bytes:new TextEncoder().encode(text).byteLength,text};},item.path);if(sample.status!==200||!sample.text.includes(item.marker))throw Error(`${item.name}_DOCUMENT_CONTRACT_FAILED_${sample.status}`);sample.sha256=createHash('sha256').update(sample.text).digest('hex');delete sample.text;sample.n=n;(n<5?data.documentWarmups:data.documentSamples).push(sample);save();}await c.close();
  for(const width of [390,768,1024,1440])for(let round=0;round<5;round++){
   const c=await browser.newContext({...options,viewport:{width,height:900},storageState:states[item.role]});const p=await c.newPage();let requests=0;const bodies=[];p.on('request',()=>requests++);p.on('pageerror',error=>result.diagnostics.push({route:item.name,width,message:error.message.slice(0,500)}));p.on('response',r=>{if(new URL(r.url()).pathname.endsWith('.js'))bodies.push(r.body().then(b=>gzipSync(b).length).catch(()=>null));});
   const start=performance.now();const response=await p.goto(item.path);expect(response.status()).toBe(200);await expect(p.locator('main').first()).toContainText(item.marker);await expect(p.locator('main button,main a,main summary').first()).toBeVisible();
   const ms=performance.now()-start;const visible=await p.locator('main').first().innerText();const bounds=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
   const targets=await p.locator('main button:visible,main a:visible,main summary:visible').evaluateAll(elements=>elements.slice(0,15).map(el=>({tag:el.tagName,text:el.textContent?.slice(0,80),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
   const row={mainCount:await p.locator('main').count(),width,round:round+1,ms,requests,bounds,targets,visibleSha256:createHash('sha256').update(visible).digest('hex'),jsGzipBytes:(await Promise.all(bodies)).reduce((a,b)=>a+(b??0),0)};data.freshContexts.push(row);save();await p.screenshot({path:`${directory}/${phase}-${item.name}-${width}-${round+1}.png`,fullPage:true});await c.close();
  }
 }
 result.status='MEASURED';
}catch(error){result.status='INCOMPLETE';result.failure=error.message;process.exitCode=1;}finally{await browser.close();result.finishedAt=new Date().toISOString();save();}
