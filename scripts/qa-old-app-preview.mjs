import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {hash} from 'bcryptjs';
import {chromium,expect} from '@playwright/test';
import {OLD_APP_SOURCE} from './ci/delivery-old-app-preview.mjs';
import {verifyOldAppBuildContext,oldAppBuildArguments,oldAppFixtureIdentity} from './ci/delivery-old-app-build.mjs';
import {oldAppProfileCleanupSql,oldAppOrderCleanupSql,oldAppCleanupAllowed} from './ci/delivery-old-app-cleanup.mjs';
import {preparePreviewFixture,restorePreviewFixture} from './qa-preview-fixture-state.ts';

const organization='11111111-1111-4111-8111-111111111111',stall='22222222-2222-4222-8222-222222222222';
const phase=process.env.REHEARSAL_PHASE;
let stage='preflight';
async function main(){
 verifyOldAppBuildContext(process.env);oldAppBuildArguments(process.env);
 assert.ok(['baseline','cutover','recovery','restore'].includes(phase));
 assert.match(process.env.FIXTURE_BASELINE_SHA256??'',/^[a-f0-9]{64}$/);
 const base=new URL(process.env.OLD_APP_PREVIEW_URL);
 assert.equal(base.origin+'/',base.href);
 assert.match(base.origin,/^https:\/\/stallorder-platform-[a-z0-9]+-ada76145-8663s-projects\.vercel\.app$/);
 const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;assert.ok(bypass&&bypass.length>=20);
 const headers={'x-vercel-protection-bypass':bypass};
 const version=await fetch(base.origin+'/api/version',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(version.status,200);assert.equal((await version.json()).revision,OLD_APP_SOURCE.commit);
 const prisma=new PrismaClient();
 const owned=oldAppFixtureIdentity(process.env.FIXTURE_IDENTITY,phase);
 const ids=owned.profiles,password=randomBytes(32).toString('base64url');
 const qrId=owned.qrId,qrToken='preview-rotation-'+qrId,note=owned.note;
 let fixture,browser,orderId,failure,unknownRequest=false,databaseWritePending=false;
 const pending=new Set();
 const cleanupFailures=[];
 const startedAt=new Date().toISOString();
 try{
  stage='fixture';
  // Record exact owned IDs before the first write, including unknown commit outcomes.
  console.log(JSON.stringify({event:'old-app-fixture-intent',profileIds:ids,qrId,note,runId:process.env.GITHUB_RUN_ID}));
  const template=await prisma.qrCode.findUniqueOrThrow({where:{token:'demo-aming-chicken-table-a1-qr-2026'}});
  assert.equal(template.organizationId,organization);assert.equal(template.stallId,stall);assert.equal(template.state,'ACTIVE');
  const version=(await prisma.qrCode.aggregate({where:{stallId:stall},_max:{tokenVersion:true}}))._max.tokenVersion;
  assert.ok(Number.isSafeInteger(version)&&version>0&&version<2147483647);
  const passwordHash=await hash(password,12);
  databaseWritePending=true;
  await prisma.$transaction([...ids.map((id,index)=>prisma.profile.create({data:{id,email:'preview-rotation-'+id+'@stallorder.invalid',
   displayName:'Preview credential rehearsal',passwordHash,emailVerified:true,authMigrationRequired:false,
   ...(index===0?{organizationMemberships:{create:{organizationId:organization,role:'ORGANIZATION_OWNER',isPrimaryOwner:false}}}
    :{stallMemberships:{create:{organizationId:organization,stallId:stall,role:'STAFF'}}})}})),
   prisma.qrCode.create({data:{id:qrId,organizationId:organization,stallId:stall,token:qrToken,label:'Credential rehearsal',state:'ACTIVE',tokenVersion:version+1,
    diningTableId:template.diningTableId,locationId:template.locationId,marketEventId:template.marketEventId,
    stallScheduleId:template.stallScheduleId,fulfillmentTypeContext:template.fulfillmentTypeContext}})]);
  databaseWritePending=false;
  databaseWritePending=true;fixture=await preparePreviewFixture(prisma,state=>{
   assert.equal(createHash('sha256').update(JSON.stringify(state.before)).digest('hex'),process.env.FIXTURE_BASELINE_SHA256);
   fixture=state;
  });
  databaseWritePending=false;
  browser=await chromium.launch();
  const errors=[];
  const context=async()=>{
   const c=await browser.newContext({locale:'zh-TW',timezoneId:'Asia/Taipei',serviceWorkers:'block'});
   await c.route(base.origin+'/**',route=>route.continue({headers:{...route.request().headers(),...headers}}));
   const page=await c.newPage();page.setDefaultTimeout(30000);page.on('pageerror',()=>errors.push('pageerror'));
   page.on('request',r=>{if(r.method()==='POST'&&/\/(?:create-order-session|create-public-order|api\/auth\/login)$/.test(r.url()))pending.add(r);});
   page.on('response',r=>{if(pending.has(r.request())&&![200,201].includes(r.status()))unknownRequest=true;});
   page.on('requestfinished',r=>pending.delete(r));
   page.on('requestfailed',r=>{if(pending.delete(r))unknownRequest=true;});
   // This credential rehearsal exercises the unchanged Edge path. A fallback
   // request is rejected before dispatch and cannot silently broaden the test.
   await c.route(base.origin+'/api/public/order-session',route=>{errors.push('unexpected-circuit-b');return route.abort();});
   await c.route(base.origin+'/api/public/orders',route=>{errors.push('unexpected-circuit-b');return route.abort();});
   return {c,page};
  };
  await mkdir('artifacts',{recursive:true});
  for(const [index,id] of ids.entries()){
   stage=index===0?'merchant-login':'staff-login';
   const {c,page}=await context();
   await page.goto(base.origin+(index===0?'/login':'/staff/login'));
   await page.getByRole('button',{name:'使用電子郵件與密碼登入',exact:true}).click();
   await page.getByLabel('電子郵件').fill('preview-rotation-'+id+'@stallorder.invalid');
   await page.getByLabel('密碼').fill(password);
   const [login]=await Promise.all([page.waitForResponse(r=>r.url()===base.origin+'/api/auth/login'&&r.request().method()==='POST'),
    page.getByRole('button',{name:'登入',exact:true}).click()]);assert.equal(login.status(),200);
   await expect(page).toHaveURL(index===0?/\/merchant\/dashboard\?organizationId=/:/\/staff\/aming-chicken/);
   if(index===0)await expect(page.locator('#main-content').getByText('營運總覽',{exact:true})).toBeVisible();
   await page.reload();await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
   await page.screenshot({path:`artifacts/old-app-${phase}-${index===0?'merchant':'staff'}.png`});
   await c.close();
  }
  stage='qr-session';
  const {c,page}=await context();
  const [sessionResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/create-order-session')&&r.request().method()==='POST'),
   page.goto(base.origin+'/q/'+qrToken)]);assert.ok([200,201].includes(sessionResponse.status()));
  const body=await sessionResponse.json();assert.match(body.orderSessionToken??'',/^stos_[A-Za-z0-9_-]{43}$/);
  const issued=await prisma.orderSession.findUniqueOrThrow({where:{tokenHash:createHash('sha256').update(body.orderSessionToken).digest('hex')}});
  assert.equal(issued.qrCodeId,qrId);assert.equal(issued.organizationId,organization);assert.equal(issued.stallId,stall);
  assert.ok(Date.parse(body.expiresAt)>Date.now());assert.equal(body.orderingMode,'DEFAULT');
  await page.setViewportSize({width:390,height:844});
  const add=page.getByRole('button',{name:'增加 冬瓜茶',exact:true});await expect(add).toBeEnabled();await add.click();
  await page.getByTestId('qr-mobile-cart-summary').click();
  await page.getByTestId('qr-cart-panel').getByRole('button',{name:'繼續填寫訂購資料',exact:true}).click();
  const upsell=page.getByRole('dialog',{name:'結帳前，再看看',exact:true});
  if(await upsell.isVisible())await upsell.getByRole('button',{name:'不用，直接結帳',exact:true}).click();
  await page.getByLabel('訂單備註',{exact:true}).fill(note);
  const acknowledgment=page.getByRole('checkbox',{name:/我已了解目前預估等候時間/});
  if(await acknowledgment.isVisible())await acknowledgment.check();
  stage='qr-order';
  // Capture the UUID before sending the request so response loss cannot hide an owned order.
  await c.route('**/create-public-order',async route=>{
   const request=route.request(),data=request.postDataJSON();assert.equal(data.customerNote,note);
   assert.match(data.clientOrderId,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
   assert.ok(!orderId||orderId===data.clientOrderId);orderId=data.clientOrderId;
   console.log(JSON.stringify({event:'old-app-order-intent',orderId,note}));
   await route.continue({headers:request.url().startsWith(base.origin+'/')?{...request.headers(),...headers}:request.headers()});
  });
  const [submitted]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/create-public-order')&&r.request().method()==='POST'),
   page.getByRole('button',{name:'送出訂單',exact:true}).click()]);
  assert.ok([200,201].includes(submitted.status()));
  const owned=await prisma.order.findFirst({where:{id:orderId,organizationId:organization,stallId:stall,note,source:'QR_MENU'}});
  assert.ok(owned);assert.equal(owned.stockConsumed,false);
  databaseWritePending=true;
  assert.equal((await prisma.order.updateMany({where:{id:orderId,organizationId:organization,stallId:stall,note},data:{isTest:true}})).count,1);
  databaseWritePending=false;
  stage='tracker';await expect(page).toHaveURL(/\/order\/sto_/);
  await expect(page.getByTestId('public-order-tracker-header')).toBeVisible();
  await page.screenshot({path:`artifacts/old-app-${phase}-order.png`});await c.close();
  assert.equal(errors.length,0);
 }catch{failure=stage;}
 // A failed close or unanswered write keeps fixtures intact for explicit reconciliation.
 try{await browser?.close();}catch{cleanupFailures.push('browser');}
 const requestsSettled=oldAppCleanupAllowed({unknownRequest,pendingRequests:pending.size,databaseWritePending,browserStopped:cleanupFailures.length===0});
 if(!requestsSettled)cleanupFailures.push('requests-unsettled');
 for(const [name,cleanup] of [
  ['order',async()=>{await prisma.$executeRawUnsafe(oldAppOrderCleanupSql({qrId,orderId,note}));}],
  ['profiles',async()=>{for(const id of ids)await prisma.$executeRawUnsafe(oldAppProfileCleanupSql(id));}],
  ['fixture',async()=>{if(fixture)await restorePreviewFixture(prisma,fixture);}],
 ]){if(requestsSettled){try{await cleanup();}catch{cleanupFailures.push(name);}}}
 try{await prisma.$disconnect();}catch{cleanupFailures.push('database');}
 const result={schema:'stallorder-old-app-usage/v1',phase,startedAt,finishedAt:new Date().toISOString(),source:OLD_APP_SOURCE.commit,
  origin:base.origin,database:'teunnvfakbfzmodajqjz',status:!failure&&!cleanupFailures.length?'passed':'failed',failure,cleanupFailures,
  merchantPasswordLogin:!failure,staffPasswordLogin:!failure,publicQrOrder:!failure,ownedFixtureCleanupVerified:cleanupFailures.length===0,
  requestsSettled,databaseWritePending,recoveryRequired:cleanupFailures.length>0,retainedSharedEffects:['monotonic-order-counter','naturally-expiring-rate-buckets','global-request-attempts'],
  serviceWorkers:'blocked-for-deployment-protection',oauth:'not-tested',originalArtifactEquivalent:false,releaseAuthorized:false};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/old-app-${phase}-usage.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));assert.equal(result.status,'passed');
}
void main().catch(()=>{console.error('OLD_APP_PREVIEW_QA_FAILED',{stage});process.exitCode=1;});
