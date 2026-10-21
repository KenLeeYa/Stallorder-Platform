import {createHmac} from 'node:crypto';
import {expect,type Page,type Browser} from '@playwright/test';
import type {PrismaClient} from '@prisma/client';
import {establishLocalTestSession} from '../local-navigation';

export type LegacyManagementFixture={admin:string;nonadmin:string;integration:string;organization:string;stall:string;callback:string;unknownJob:string;unknownOrganization:string;unknownStall:string;unknownOrder:string;contact:string;recipientReference:string;subject:string;eventId:string};
export async function runLegacyManagementAcceptance(page:Page,browser:Browser,db:PrismaClient,fixture:LegacyManagementFixture,record:(name:string,value:unknown)=>void){
 const url='/api/admin/line-platform/webhooks',base='http://127.0.0.1:3026';
 const api=async(path:string,body?:unknown,csrf=true)=>page.evaluate(async({path,body,csrf})=>{
  const token=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('stallorder_csrf='))?.slice(16)??'';
  const response=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':decodeURIComponent(token)}:{})},body:JSON.stringify(body)})});
  return{status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
 },{path,body,csrf});
 const anonymous=await browser.newContext({baseURL:base});
 try{expect((await anonymous.request.get(url)).status()).toBe(401);}finally{await anonymous.close();}
 const denied=await browser.newContext({baseURL:base}),nonadmin=await denied.newPage();
 try{await establishLocalTestSession(nonadmin,db,fixture.nonadmin);expect((await denied.request.get(url)).status()).toBe(404);}finally{await denied.close();}
 await establishLocalTestSession(page,db,fixture.admin);await page.goto(base+'/admin/line-platform');
 const section=page.getByRole('region',{name:'商家 LINE 與 Webhook 管理'});
 await expect(section.getByLabel('LINE 整合')).toBeEnabled();await section.getByLabel('LINE 整合').selectOption(fixture.integration);
 await section.getByRole('button',{name:'讀取目前 Mock Webhook',exact:true}).click();await expect(section.getByTestId('legacy-webhook-readback')).toContainText('Webhook 停用');
 const listed=await api(url);expect(listed.status).toBe(200);expect(listed.cache).toBe('no-store');
 const target=listed.body.integrations.find((row:{integrationId:string})=>row.integrationId===fixture.integration);
 expect(target).toMatchObject({capability:'DISABLED',status:'ACTIVE',localMockAvailable:true,senderPolicy:'MERCHANT_OA'});
 expect(JSON.stringify(target)).not.toContain('secret_reference');expect(JSON.stringify(target)).not.toContain('9990004');
 const command={operation:'TEST',integrationId:fixture.integration,organizationId:fixture.organization,stallId:fixture.stall,environment:'local',channelBinding:target.channelBinding,expectedVersion:target.expectedVersion,callbackUrl:fixture.callback,senderPolicy:'MERCHANT_OA'};
 expect((await api(url,command,false)).status).toBe(403);
 expect((await api(url,{...command,environment:'production'})).status).toBe(400);
 expect((await api(url,{...command,channelBinding:'a'.repeat(64)})).status).toBe(409);
 expect((await api(url,{...command,expectedVersion:999})).status).toBe(409);
 for(const callbackUrl of ['http://169.254.169.254/latest/meta-data','https://user:secret@b4c.example.test/api/webhooks/line/'+fixture.integration,'https://b4c.example.test/api/webhooks/line/'+fixture.integration+'?token=secret'])expect((await api(url,{...command,callbackUrl})).status).toBe(409);
 record('authorization-and-callback-denials',{anonymous:401,nonadmin:404,csrf:403,wrongEnvironment:400,channel:409,version:409,callbackCases:3});
 await section.getByLabel('HTTPS Webhook Callback URL').fill(fixture.callback);await section.getByLabel('發送帳號方案').selectOption('PLATFORM_OA');
 await section.getByRole('button',{name:'測試 Mock Webhook',exact:true}).click();await expect(section.getByRole('heading',{name:'待套用差異'})).toBeVisible();
 const beforeApply=await db.notificationIntegration.findUniqueOrThrow({where:{id:fixture.integration}});
 const settings=beforeApply.settingsJson as {webhookManagement:{version:number;senderPolicy:string;tested:{digest:string}}};expect(settings.webhookManagement.senderPolicy).toBe('MERCHANT_OA');
 expect((await api(url,{...command,operation:'APPLY',expectedVersion:settings.webhookManagement.version,testedDigest:'b'.repeat(64),callbackUrl:undefined,senderPolicy:undefined})).status).toBe(409);
 await section.getByRole('button',{name:'確認套用已測試差異',exact:true}).click();await expect(section.getByRole('status').filter({hasText:'已套用並讀回 Mock 設定'})).toBeVisible();
 await expect(section.getByTestId('legacy-webhook-readback')).toContainText(fixture.callback);
 const applied=await db.notificationIntegration.findUniqueOrThrow({where:{id:fixture.integration}});expect(applied.settingsJson).toMatchObject({webhookManagement:{senderPolicy:'PLATFORM_OA',callbackUrl:fixture.callback,localMock:true}});
 expect((applied.settingsJson as {webhookManagement:{tested?:unknown}}).webhookManagement.tested).toBeUndefined();
 expect((await api(url,{operation:'APPLY',integrationId:fixture.integration,organizationId:fixture.organization,stallId:fixture.stall,environment:'local',channelBinding:target.channelBinding,expectedVersion:settings.webhookManagement.version,testedDigest:settings.webhookManagement.tested.digest})).status).toBe(409);
 await section.getByRole('button',{name:'讀取目前 Mock Webhook',exact:true}).click();await expect(section.getByTestId('legacy-webhook-readback')).toContainText(fixture.callback);
 record('read-test-diff-apply-readback',{senderPolicy:'PLATFORM_OA',realDeliveryEnabled:false,remoteActive:false,masked:true});
 const unknownBefore=await db.notificationJob.findUniqueOrThrow({where:{id:fixture.unknownJob}});
 const card=section.getByRole('listitem').filter({hasText:fixture.unknownOrder.slice(0,8)});await expect(card).toContainText('UNKNOWN');
 await card.getByRole('button',{name:'確認處理條件'}).click();await expect(section.getByRole('status').filter({hasText:'保留待人工確認狀態'})).toBeVisible();
 expect(await db.notificationJob.findUniqueOrThrow({where:{id:fixture.unknownJob}})).toEqual(unknownBefore);record('unknown-reconcile',{state:'EVIDENCE_REQUIRED',rowUnchanged:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const buttons=await section.getByRole('button').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));expect(buttons.every(box=>box.width>=48&&box.height>=48)).toBe(true);record('mobile-controls',{width:390,noHorizontalOverflow:true,minimumTarget:48});
 await runLegacyPostApplyAcceptance(page,db,fixture,record);
}

export async function runLegacyPostApplyAcceptance(page:Page,db:PrismaClient,fixture:LegacyManagementFixture,record:(name:string,value:unknown)=>void){
 const base='http://127.0.0.1:3026',url='/api/admin/line-platform/webhooks';
 const section=page.getByRole('region',{name:'商家 LINE 與 Webhook 管理'});
 const webhook=base+'/api/webhooks/line/'+fixture.integration;
 const signed=async(body:unknown,signedBody?:string)=>{const raw=JSON.stringify(body),signature=createHmac('sha256','SIMULATED-MOUNTED-MESSAGING-'+fixture.integration).update(signedBody??raw).digest('base64');return page.request.post(webhook,{headers:{'content-type':'application/json','x-line-signature':signature},data:raw});};
 expect((await signed({destination:'9990003',events:[]})).status()).toBe(403);
 expect((await signed({events:[]})).status()).toBe(400);
 expect((await signed({destination:'USIMULATED-MOUNTED',events:[]},'{}')).status()).toBe(401);
 const event={destination:'USIMULATED-MOUNTED',events:[{type:'unfollow',timestamp:1,webhookEventId:fixture.eventId,source:{type:'user',userId:fixture.subject}}]};
 expect((await signed(event)).status()).toBe(200);expect((await signed(event)).status()).toBe(200);
 expect(await db.lineWebhookEvent.count({where:{integrationId:fixture.integration}})).toBe(1);expect((await db.customerContactLink.findUniqueOrThrow({where:{id:fixture.contact}})).consentStatus).toBe('REVOKED');
 expect(await db.$queryRaw`select id from vault.secrets where id=${fixture.recipientReference}::uuid`).toEqual([]);record('mounted-raw-hmac-and-vault-revoke',{wrongDestination:403,missingDestination:400,wrongBody:401,replay:200,eventCount:1,syntheticRecipientSecretDeleted:true});
 // Hold the actual selected read response across the existing authority invalidation signal.
 let release=()=>{},received=()=>{},settled=()=>{};const held=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>received=resolve),finished=new Promise<void>(resolve=>settled=resolve);
 const pattern='**/api/admin/line-platform/webhooks?integrationId=*';
 await page.route(pattern,async route=>{try{const response=await route.fetch();received();await held;await route.fulfill({response}).catch(()=>{});}finally{settled();}},{times:1});
 await section.getByLabel('LINE 整合').selectOption(fixture.integration);await section.getByRole('button',{name:'讀取目前 Mock Webhook',exact:true}).click();
 try{await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('HELD_READ_TIMEOUT')),10000))]);
  await page.evaluate(()=>window.dispatchEvent(new Event('stallorder:private-view-invalidated')));await expect(section.getByText('私人資料已清除。',{exact:true})).toBeVisible();
  await expect(section.getByRole('listitem')).toHaveCount(0);await expect(section.getByTestId('legacy-webhook-readback')).toHaveCount(0);
 }finally{release();await finished;await page.unroute(pattern);}
 await expect(section.getByRole('listitem')).toHaveCount(0);await expect(section.getByTestId('legacy-webhook-readback')).toHaveCount(0);record('private-authority-late-response',{signal:'existing-authority-invalidation',heldActualResponse:true,latePrivateStateReturned:false});
 // A fresh page checks the real mounted 401 response after revoking only this synthetic session.
 const [logout]=await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/auth/logout')&&response.request().method()==='POST'),page.getByRole('button',{name:'登出',exact:true}).filter({visible:true}).first().click()]);record('logout-response',{status:logout.status()});expect(logout.status()).toBe(200);
 await expect(page).toHaveURL(/\/login/);expect((await page.request.get(base+url)).status()).toBe(401);await page.goto(base+'/admin/line-platform');await expect(page).toHaveURL(/\/login/);record('actual-logout',{privateApi:401,protectedPageRedirect:true,actualButton:true});
}
