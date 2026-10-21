import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {test,expect,type Page,type Browser} from '@playwright/test';
import type {PrismaClient} from '@prisma/client';
import {establishLocalTestSession,gotoLocalPath,dismissStaffStartReminder} from '../local-navigation';
import {openGuardedDatabase,verifyLiveFixture,actors,bindOwnedSession} from '../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
import {readResponsiveBuildProvenance} from '../../scripts/responsive-build-provenance.mjs';
import {proveStaffPushRejection} from '../../scripts/awesome-optimization/batch-4a/mock-staff-push.mjs';
import {offlineStoreDefinitions} from '../../src/offline/offline-db';
import {OFFLINE_DATABASE_NAME,OFFLINE_DATABASE_VERSION,OFFLINE_SCHEMA_VERSION,OFFLINE_APP_PROTOCOL_VERSION} from '../../src/offline/offline-contract';
let db:PrismaClient;
const marker=`awesome-b4a-fix1-${randomUUID()}`;
const proof:{fixtures:unknown[];checks:unknown[];[key:string]:unknown}={marker,syntheticLocalOnly:true,fixtures:[],checks:[]};
const prefix=`.superpowers/sdd/2026-10-01-awesome-optimization/batch-4a/fix-1/browser-${process.env.BATCH4A_RECEIPT_LABEL}`;
const historical=JSON.parse(readFileSync('.superpowers/sdd/2026-10-01-awesome-optimization/batch-4a/staff-facts-complete.json','utf8'));
async function preserveStaff(){
 const deliveries=await db.staffPushDelivery.findMany({where:{id:{in:historical.deliveries.map((v:{id:string})=>v.id)}},orderBy:{id:'asc'}});
 const subscriptions=await db.staffPushSubscription.findMany({where:{id:{in:historical.subscriptions.map((v:{id:string})=>v.id)}},orderBy:{id:'asc'}});
 expect(JSON.parse(JSON.stringify({deliveries,subscriptions}))).toEqual({deliveries:historical.deliveries,subscriptions:historical.subscriptions});return{deliveries,subscriptions};
}
test.beforeAll(async()=>{if(!process.env.BATCH4A_RECEIPT_LABEL||existsSync(`${prefix}.json`))throw Error('IMMUTABLE_OUTPUT_LABEL_REQUIRED');proof.runtime=readResponsiveBuildProvenance({expectedSourceSha256:process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256});db=await openGuardedDatabase();proof.corpus=(await verifyLiveFixture(db)).receipt;proof.staffBefore=await preserveStaff();});
test.afterAll(async()=>{try{proof.staffAfter=await preserveStaff();proof.corpusAfter=(await verifyLiveFixture(db)).receipt;}finally{proof.finishedAt=new Date().toISOString();writeFileSync(`${prefix}.json`,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});await db.$disconnect();}});
async function profile(){const id=randomUUID(),email=`${marker}-${id}@stallorder.test`;expect(await db.profile.count({where:{id}})).toBe(0);proof.fixtures.push({profileId:id,preimage:'ABSENT'});await db.profile.create({data:{id,email,displayName:marker,authIdentities:{create:{provider:'GOOGLE',providerSubject:`${marker}/${id}`,providerEmail:email,providerEmailVerified:true}}}});return id;}
async function api(page:Page,path:string,method='GET',body?:unknown){return page.evaluate(async({path,method,body})=>{const csrf=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('stallorder_csrf='))?.slice('stallorder_csrf='.length)??'';const response=await fetch(path,{method,cache:'no-store',headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};},{path,method,body});}
async function approve(browser:Browser,id:string,kds=false){
 const applicationId=randomUUID(),p=await db.profile.findUniqueOrThrow({where:{id}}),name=`Fix1 ${applicationId.slice(0,8)}`;
 expect(await db.merchantApplication.count({where:{id:applicationId}})).toBe(0);proof.fixtures.push({applicationId,preimage:'ABSENT',needsKitchenView:kds});
 await db.merchantApplication.create({data:{id:applicationId,applicantProfileId:id,applicantEmail:p.email!,applicantDisplayName:p.displayName,phone:'0967777777',phoneHash:createHash('sha256').update(applicationId).digest('hex'),preferredContactMethod:'PHONE',merchantName:name,businessType:'NIGHT_MARKET_STALL',contactName:'合成使用者',businessPhone:'0967777777',businessAddress:'臺北市合成路100號',city:'臺北市',stallName:name,stallLocation:'本機測試',requestedSlug:`fix1-${applicationId.slice(0,8)}`,needsMultipleStaff:false,needsKitchenView:kds,requestedPlanCode:'TRIAL',termsAccepted:true,privacyAccepted:true,dataProcessingAccepted:true,informationConfirmed:true,status:'PENDING_REVIEW',currentStep:4,draftVersion:3,submittedAt:new Date(),consentedAt:new Date()}});
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3026'}),admin=await context.newPage();
 try{await establishLocalTestSession(admin,db,actors.admin.id);await bindOwnedSession(db,context,actors.admin);await gotoLocalPath(admin,`/admin/merchant-applications/${applicationId}`);expect((await api(admin,`/api/admin/merchant-applications/${applicationId}`,'PATCH',{action:'APPROVE'})).status).toBe(200);}finally{await context.close();}
 const application=await db.merchantApplication.findUniqueOrThrow({where:{id:applicationId}}),organizationId=application.approvedOrganizationId!;
 const setup=await db.merchantSetupProgress.findUniqueOrThrow({where:{organizationId},include:{stall:true}});proof.fixtures.push({organizationId,stallId:setup.stallId,source:'actual authorized approval'});return{applicationId,organizationId,stallId:setup.stallId,slug:setup.stall.slug,name};
}
async function heldDetail(page:Page,source:string){
 let release=()=>{},received=()=>{},settled=()=>{};const held=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>received=resolve),finished=new Promise<void>(resolve=>settled=resolve);const pattern=`**/api/notifications/${source}/*?*`;
 const handler=async(route:import('@playwright/test').Route)=>{const response=await route.fetch();received();await held;try{await route.fulfill({response}).catch(()=>{});}finally{settled();}};
 await page.route(pattern,handler,{times:1});await page.getByRole('region',{name:'通知列表'}).getByRole('button').first().click();await ready;await expect(page.getByText('正在讀取通知詳情…',{exact:true})).toBeVisible();
 return async()=>{release();await finished;await page.unroute(pattern,handler);};
}
async function offlineSentinel(page:Page,stallId:string,localId:string,create:boolean){
 return page.evaluate(async({name,version,definitions,stallId,localId,create,schema,protocol})=>{
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(name,version);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);request.onupgradeneeded=()=>{for(const [store,definition]of Object.entries(definitions)){if(request.result.objectStoreNames.contains(store))continue;const target=request.result.createObjectStore(store,{keyPath:definition.keyPath});for(const index of definition.indexes??[])target.createIndex(index.name,index.keyPath,index.options);}};});
  try{return await new Promise((resolve,reject)=>{
   const transaction=database.transaction(['offline_orders','sync_queue'],create?'readwrite':'readonly');const orders=transaction.objectStore('offline_orders'),queue=transaction.objectStore('sync_queue');
   if(create){const at=new Date().toISOString(),metadata={schema_version:schema,app_protocol_version:protocol,created_at:at,updated_at:at};orders.add({...metadata,local_order_id:localId,stall_id:stallId,sync_status:'PENDING',synthetic_preservation_sentinel:true});queue.add({...metadata,queue_id:localId,idempotency_key:localId,stall_id:stallId,local_order_id:localId,status:'PENDING',next_attempt_at:at,synthetic_preservation_sentinel:true});}
   const order=orders.get(localId),item=queue.get(localId);transaction.oncomplete=()=>resolve({order:order.result,queue:item.result});transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });}finally{database.close();}
 },{name:OFFLINE_DATABASE_NAME,version:OFFLINE_DATABASE_VERSION,definitions:offlineStoreDefinitions,stallId,localId,create,schema:OFFLINE_SCHEMA_VERSION,protocol:OFFLINE_APP_PROTOCOL_VERSION});
}

test('SQL microsecond Billing and Application pagination is complete and authorized; held detail next page settles',async({page,browser},testInfo)=>{
 test.setTimeout(180000);const id=await profile(),fixture=await approve(browser,id);await establishLocalTestSession(page,db,id);await gotoLocalPath(page,'/notifications?kind=PERSONAL');
 const second=new Date(Date.now()-86400000).toISOString().slice(0,19);
 for(const source of ['BILLING','APPLICATION'] as const){
  const ids:string[]=[];
  for(let n=0;n<25;n++){const noticeId=randomUUID(),stamp=second+(n<21?'.123456Z':['.123455Z','.123454Z','.123002Z','.123001Z'][n-21]);ids.push(noticeId);
   if(source==='BILLING')await db.$executeRaw`insert into public.billing_notifications(id,organization_id,notification_type,title,message,created_at) values(${noticeId}::uuid,${fixture.organizationId}::uuid,'TRIAL_ENDING_7_DAYS',${`Billing precision ${n}`},'private precision canary',${stamp}::timestamptz)`;
   else await db.$executeRaw`insert into public.merchant_application_notifications(id,application_id,profile_id,type,title,message,created_at) values(${noticeId}::uuid,${fixture.applicationId}::uuid,${id}::uuid,'MERCHANT_APPLICATION_NEEDS_INFO',${`Application precision ${n}`},'private precision canary',${stamp}::timestamptz)`;
  }
  const expected=source==='BILLING'?await db.$queryRaw<{id:string;precise:string}[]>`select id,created_at::text as precise from public.billing_notifications where id=any(${ids}::uuid[]) order by created_at desc,id desc`:await db.$queryRaw<{id:string;precise:string}[]>`select id,created_at::text as precise from public.merchant_application_notifications where id=any(${ids}::uuid[]) order by created_at desc,id desc`;
  const scope=source==='BILLING'?`kind=ORGANIZATION&organizationId=${fixture.organizationId}`:'kind=PERSONAL',query=`${scope}&from=${second}.000Z&to=${second}.999Z&limit=10`;
  const pages:unknown[]=[],actual:string[]=[];let cursor:string|null=null;
  do{const response=await api(page,`/api/notifications?${query}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);expect(response.status).toBe(200);expect(response.body.unreadCount).toBe(25);pages.push(response.body);actual.push(...response.body.items.map((v:{id:string})=>v.id));cursor=response.body.nextCursor;expect(pages.length).toBeLessThanOrEqual(3);}while(cursor);
  expect(actual).toEqual(expected.map(v=>v.id));expect(new Set(actual).size).toBe(25);
  const unread=await api(page,`/api/notifications?${query}&unreadOnly=true`),anchor=unread.body.items.at(-1).id;
  expect((await api(page,`/api/notifications?${query}&cursor=${encodeURIComponent(unread.body.nextCursor)}`)).status).toBe(400);
  expect((await api(page,`/api/notifications/${source}/${anchor}/read?${scope}`,'PATCH',{})).status).toBe(200);
  const denied=await api(page,`/api/notifications?${query}&unreadOnly=true&cursor=${encodeURIComponent(unread.body.nextCursor)}`);expect(denied.status).toBe(400);expect(denied.body.code).toBe('INBOX_CURSOR_INVALID');
  expect((await api(page,`/api/notifications?${query}`)).body.unreadCount).toBe(24);
  proof.fixtures.push({source,ids,preimage:'ABSENT',precisionInsertedDirectly:true});proof.checks.push({case:`${source} microsecond exact-once SQL/API and current unread-anchor denial`,status:'PASS',expected,actual,pages,denied});
 }
 await gotoLocalPath(page,`/notifications?kind=ORGANIZATION&organizationId=${fixture.organizationId}`);await expect(page.getByRole('button',{name:'下一頁',exact:true})).toBeEnabled();const release=await heldDetail(page,'BILLING');
 try{await page.getByRole('button',{name:'下一頁',exact:true}).click();await expect(page.getByRole('region',{name:'通知列表'})).toBeVisible();await expect(page.getByText('正在讀取通知詳情…',{exact:true})).not.toBeVisible();}finally{await release();}
 await expect(page.getByRole('region',{name:'通知詳情'})).not.toBeVisible();await page.screenshot({path:testInfo.outputPath('detail-nextpage-settled.png'),fullPage:true});proof.checks.push({case:'held actual detail→nextpage resets loading and ignores late result',status:'PASS'});
});

test('authorized KDS-on Staff→Kitchen survives push rejection; real workspace switch and logout discard held private views',async({page,browser},testInfo)=>{
 test.setTimeout(300000);const id=await profile(),first=await approve(browser,id,true),secondId=await profile(),second=await approve(browser,secondId);
 // Add only this task's second organization membership after its real active trial approval.
 await db.organizationMembership.create({data:{organizationId:second.organizationId,profileId:id,role:'ORGANIZATION_OWNER',allStalls:true}});proof.fixtures.push({membership:{organizationId:second.organizationId,profileId:id},preimage:'ABSENT'});
 await establishLocalTestSession(page,db,id);await gotoLocalPath(page,`/merchant/dashboard?organizationId=${first.organizationId}`);
 const settings=await db.stallOrderingSettings.findUniqueOrThrow({where:{stallId:first.stallId}});
 const fields=['dineInEnabled','deliveryModuleEnabled','staffDeliveryEnabled','printModuleEnabled','paymentModuleEnabled','discountModuleEnabled','discountApprovalThresholdBps','takeoutPreorderEnabled','preorderMinLeadMinutes','preorderMaxDays','preorderSlotMinutes','lotteryEnabled','lotteryDiscountOptionId','lotteryDiscountWinRateBps','lotterySpendRewardEnabled','lotterySpendThresholdAmount','lotteryFestivalRewardEnabled','lotteryFestivalStartsOn','lotteryFestivalEndsOn','lotteryBirthdayRewardEnabled'] as const;
 const command={...Object.fromEntries(fields.map(key=>[key,settings[key]])),operation:'UPDATE_MODULES',view:'kds',kdsModuleEnabled:true};
 const enabled=await api(page,`/api/merchant/stalls/${first.stallId}/modules`,'PATCH',command);proof.checks.push({case:'current authorized KDS entitlement/module setup',response:enabled});expect(enabled.status).toBe(200);expect((await db.stallOrderingSettings.findUniqueOrThrow({where:{stallId:first.stallId}})).kdsModuleEnabled).toBe(true);
 for(const step of ['MERCHANT_PROFILE','STALL_PROFILE','CATALOG','PAYMENT_OPTIONS','TEAM','QR_PREVIEW'])expect((await api(page,`/api/merchant/organizations/${first.organizationId}/setup`,'PATCH',{action:'COMPLETE_STEP',step})).status).toBe(200);
 const token=(await page.context().cookies()).find(v=>v.name==='stallorder_session')!.value,session=await db.authSession.findUniqueOrThrow({where:{tokenHash:createHash('sha256').update(token).digest('hex')}});
 await preserveStaff();const chain=await proveStaffPushRejection(db,id,first.stallId,session.id,async()=>{expect((await api(page,`/api/merchant/organizations/${first.organizationId}/setup`,'PATCH',{action:'CREATE_TEST_ORDER'})).status).toBe(200);return(await db.order.findFirstOrThrow({where:{organizationId:first.organizationId,isTest:true,source:'MERCHANT_SETUP_TEST'}})).id;});proof.checks.push(chain);await preserveStaff();
 const order=await db.order.findUniqueOrThrow({where:{id:chain.orderId}}),staffQuery=`kind=STALL&stallSlug=${first.slug}`;
 expect((await api(page,`/api/notifications?${staffQuery}`)).body.items.map((v:{id:string})=>v.id)).toEqual([order.id]);const deliveries=await db.staffPushDelivery.findMany({where:{orderId:order.id},orderBy:{id:'asc'}});
 await gotoLocalPath(page,`/staff/${first.slug}`);await dismissStaffStartReminder(page);await page.getByTestId('staff-order-list-pane').getByRole('button').filter({hasText:order.orderNo}).click();
 await page.getByTestId('staff-order-actions-pane').getByRole('button',{name:'確認接單',exact:true}).click();await expect.poll(async()=>(await db.order.findUniqueOrThrow({where:{id:order.id}})).status).toBe('CONFIRMED');
 const taskStates:unknown[]=[];taskStates.push(await db.orderProductionTask.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}));expect((taskStates[0] as unknown[]).length).toBeGreaterThan(0);
 await gotoLocalPath(page,`/kitchen?stall=${first.slug}`);await page.getByRole('button',{name:new RegExp(`#${order.orderNo}\\b`)}).click();const article=page.getByRole('article',{name:`#${order.orderNo}`});await expect(article).toBeVisible();
 await article.getByRole('button',{name:'開始製作',exact:true}).click();await expect.poll(async()=>(await db.order.findUniqueOrThrow({where:{id:order.id}})).status).toBe('PREPARING');taskStates.push(await db.orderProductionTask.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}));
 await page.getByTestId('kitchen-order-items-pane').getByRole('button',{name:'完成品項',exact:true}).click();await expect.poll(async()=>(await db.order.findUniqueOrThrow({where:{id:order.id}})).status).toBe('READY');const readyTasks=await db.orderProductionTask.findMany({where:{orderId:order.id},orderBy:{id:'asc'}});expect(readyTasks.every(v=>v.status==='COMPLETED')).toBe(true);taskStates.push(readyTasks);await page.screenshot({path:testInfo.outputPath('actual-kds-ready.png'),fullPage:true});
 expect(await db.staffPushDelivery.findMany({where:{orderId:order.id},orderBy:{id:'asc'}})).toEqual(deliveries);expect((await api(page,`/api/notifications?${staffQuery}`)).body.items.map((v:{id:string})=>v.id)).toEqual([order.id]);proof.checks.push({case:'mounted Staff CONFIRMED→Kitchen PREPARING→READY, FAILED push facts unchanged and Inbox isolated',status:'PASS',orderId:order.id,taskStates});
 const canary=`private-${randomUUID()}`,otherCanary=`other-${randomUUID()}`;
 await db.billingNotification.create({data:{organizationId:first.organizationId,notificationType:'TRIAL_ENDING_7_DAYS',title:canary,message:canary}});await db.billingNotification.create({data:{organizationId:second.organizationId,notificationType:'TRIAL_ENDING_7_DAYS',title:otherCanary,message:otherCanary}});
 const sentinel={id:randomUUID(),stallId:first.stallId,profileId:id,status:'PENDING',draft:{quantity:1}};
 await page.evaluate(value=>localStorage.setItem('awesome-b4a-fix1-pending-pos',JSON.stringify(value)),sentinel);
 const offlineBefore=await offlineSentinel(page,first.stallId,sentinel.id,true);proof.fixtures.push({offlineBefore,preimage:'ABSENT',syntheticPreservationOnly:true});
 async function enterDetail(organizationId:string,title:string){await gotoLocalPath(page,`/merchant/dashboard?organizationId=${organizationId}`);await page.getByRole('link',{name:/通知中心/}).click();await page.getByRole('button',{name:new RegExp(title)}).click();await expect(page.getByRole('region',{name:'通知詳情'})).toContainText(title);await page.getByRole('button',{name:'關閉詳情',exact:true}).click();return heldDetail(page,'BILLING');}
 const releaseSwitch=await enterDetail(first.organizationId,canary);
 try{await page.goBack();await page.getByRole('button',{name:new RegExp(`選擇商家：${first.name}`)}).click();await page.getByRole('dialog',{name:'選擇商家',exact:true}).getByRole('button',{name:second.name,exact:true}).click();await page.waitForURL(url=>url.pathname==='/merchant/dashboard'&&url.searchParams.get('organizationId')===second.organizationId);await page.getByRole('link',{name:/通知中心/}).click();await page.getByRole('button',{name:new RegExp(otherCanary)}).click();await expect(page.getByRole('region',{name:'通知詳情'})).toContainText(otherCanary);}finally{await releaseSwitch();}
 await expect(page.getByText(canary,{exact:true})).not.toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('stallorder.organization.preference'))).toBe(second.organizationId);
 const releaseLogout=await enterDetail(second.organizationId,otherCanary);const currentToken=(await page.context().cookies()).find(v=>v.name==='stallorder_session')!.value,currentSession=await db.authSession.findUniqueOrThrow({where:{tokenHash:createHash('sha256').update(currentToken).digest('hex')}});
 try{await page.goBack();const loggedOut=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/logout'&&response.request().method()==='POST');await page.getByRole('button',{name:'登出',exact:true}).click();expect((await loggedOut).status()).toBe(200);await page.waitForURL(url=>url.pathname==='/login');}finally{await releaseLogout();}
 expect((await db.authSession.findUniqueOrThrow({where:{id:currentSession.id}})).revokedAt).not.toBeNull();expect((await page.request.get('/api/notifications?kind=PERSONAL')).status()).toBe(401);expect((await page.context().cookies()).some(v=>v.name==='stallorder_session')).toBe(false);
 // Real logout above; only the subsequent second-account login is a guarded synthetic fixture.
 const nextId=await profile();await establishLocalTestSession(page,db,nextId);await gotoLocalPath(page,'/notifications?kind=PERSONAL');await expect(page.getByText('目前篩選範圍沒有通知。',{exact:true})).toBeVisible();await expect(page.getByText(canary,{exact:true})).not.toBeVisible();await expect(page.getByText(otherCanary,{exact:true})).not.toBeVisible();expect((await api(page,`/api/notifications?kind=ORGANIZATION&organizationId=${first.organizationId}`)).status).toBe(404);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('awesome-b4a-fix1-pending-pos')!))).toEqual(sentinel);const offlineAfter=await offlineSentinel(page,first.stallId,sentinel.id,false);expect(offlineAfter).toEqual(offlineBefore);await page.screenshot({path:testInfo.outputPath('actual-logout-second-identity.png'),fullPage:true});proof.checks.push({case:'actual WorkspaceSwitcher/native navigation and LogoutButton/API session revoke; held details discarded across actual scope and synthetic second identity',status:'PASS',first,second,logoutSessionId:currentSession.id,nextProfileId:nextId,pendingPosSentinel:sentinel,offlineBefore,offlineAfter,providerOAuth:'NOT_RUN'});
});
