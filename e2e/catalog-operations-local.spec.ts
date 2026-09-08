import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { establishLocalTestSession, gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const ids: string[] = [];
let productId = "", secondProductId = "", qrToken = "", qrId = "", ownerId = "";
let circuitFlagOverrideId = "";
let originalHours: Awaited<ReturnType<typeof prisma.stallBusinessHour.findMany>>;
test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1","localhost"].includes(db.hostname) || db.port !== (process.env.CI ? "54322" : "55722")) throw new Error("DEDICATED_CATALOG_LOCAL_LAB_REQUIRED");
  const flag = await prisma.resilienceFeatureFlag.findUniqueOrThrow({ where: { code: "DUAL_ORDER_INTAKE_ENABLED" }, select: { id: true } });
  circuitFlagOverrideId = (await prisma.resilienceFeatureFlagOverride.create({ data: {
    flagId: flag.id, scopeType: "GLOBAL", enabled: true,
    reason: "Isolated catalog Circuit B regression",
    expiresAt: new Date(Date.now() + 15 * 60_000),
  } })).id;
  // Reset this dedicated lab's request counters between reruns; production policies stay enabled.
  await prisma.publicRateLimitBucket.deleteMany({});
  await prisma.rateLimitBucket.deleteMany({});
  ownerId = (await prisma.profile.findUniqueOrThrow({ where: { email:"owner@stallorder.test" } })).id;
  originalHours = await prisma.stallBusinessHour.findMany({ where: { stallId } });
  await prisma.stallBusinessHour.updateMany({ where:{stallId}, data:{ opensAt:"00:00",closesAt:"23:59",lastOrderAt:null,isClosed:false } });
  const category = await prisma.productCategory.findFirstOrThrow({ where:{organizationId,isActive:true} });
  for (const name of ["庫存驗收餐","庫存驗收配餐"]) {
    const product = await prisma.product.create({ data:{organizationId,categoryId:category.id,name,description:"local stock fixture",defaultPrice:60,
      stallProducts:{create:{organizationId,stallId,isEnabled:true,isSoldOut:false}}} });
    if(!productId) productId=product.id; else secondProductId=product.id;
  }
  const version = await prisma.qrCode.aggregate({where:{stallId},_max:{tokenVersion:true}});
  qrToken="catalog-"+randomUUID();
  qrId=(await prisma.qrCode.create({data:{organizationId,stallId,token:qrToken,label:"Catalog local QA",state:"ACTIVE",tokenVersion:(version._max.tokenVersion??0)+1}})).id;
});
test.afterAll(async () => {
  if (circuitFlagOverrideId) await prisma.resilienceFeatureFlagOverride.deleteMany({ where: { id: circuitFlagOverrideId } });
  await prisma.order.deleteMany({where:{id:{in:ids}}});
  if(qrId) {
    await prisma.publicOrderAttempt.deleteMany({where:{qrCodeId:qrId}});
    await prisma.orderSession.deleteMany({where:{qrCodeId:qrId}});
    await prisma.qrCode.delete({where:{id:qrId}});
  }
  const productIds=[productId,secondProductId].filter(Boolean);
  await prisma.stallProduct.deleteMany({where:{productId:{in:productIds}}});
  await prisma.product.deleteMany({where:{id:{in:productIds}}});
  for(const row of originalHours??[]) await prisma.stallBusinessHour.update({where:{id:row.id},data:{opensAt:row.opensAt,closesAt:row.closesAt,lastOrderAt:row.lastOrderAt,isClosed:row.isClosed}});
  await prisma.$disconnect();
});
async function merchantHeaders(page: Page) {
  const csrf=(await page.context().cookies()).find((cookie)=>cookie.name==="stallorder_csrf")?.value??"";
  return {origin:process.env.PLAYWRIGHT_APP_URL!,"x-csrf-token":csrf};
}
function publicHeaders() { return {origin:process.env.PLAYWRIGHT_APP_URL!,"x-stallorder-protocol-version":"1","x-stallorder-operation-id":randomUUID()}; }
async function remaining() { return (await prisma.stallProduct.findFirstOrThrow({where:{stallId,productId}})).stockRemaining; }
async function session(page:Page, mode="DEFAULT", token=qrToken, edge=false) {
  const deviceId=randomUUID();
  const response=await page.request.post(edge ? process.env.NEXT_PUBLIC_SUPABASE_URL+"/functions/v1/create-order-session" : "/api/public/order-session",{headers:publicHeaders(),data:{qrToken:token,deviceId,orderingMode:mode,sessionRequestId:randomUUID()}});
  return {response,deviceId,body:await response.json()};
}
async function submit(page:Page, quantity:number, mode="DEFAULT", edge=false) {
  const issued=await session(page,mode,qrToken,edge);
  expect(issued.response.status(),issued.body.code).toBe(201);
  const id=randomUUID();ids.push(id);
  const data={qrToken,deviceId:issued.deviceId,orderingMode:mode,orderSessionToken:issued.body.orderSessionToken,clientOrderId:id,idempotencyKey:randomUUID(),turnstileIdempotencyKey:randomUUID(),turnstileToken:"XXXX.DUMMY.TOKEN.XXXX",customerName:"庫存驗收",customerPhone:"0912345678",waitAcknowledged:true,scheduledPickupAt:mode==="PREORDER"?issued.body.preorderSlots[3]:null,items:[{productId,quantity}]};
  const response=await page.request.post(edge ? process.env.NEXT_PUBLIC_SUPABASE_URL+"/functions/v1/create-public-order" : "/api/public/orders",{headers:publicHeaders(),data});
  return {id,data,response,body:await response.json()};
}

test("stock admin is tenant scoped, CSRF protected and rejects stale whole batches",async({page})=>{
  test.setTimeout(120000);
  await establishLocalTestSession(page,prisma,ownerId);
  const headers=await merchantHeaders(page),url=`/api/merchant/stalls/${stallId}/products`;
  const original=await prisma.stallProduct.findFirstOrThrow({where:{stallId,productId}});
  const items=[{productId,mode:"SET",quantity:8,expectedVersion:original.stockVersion}];
  expect((await page.request.patch(url,{data:{operation:"BULK_STOCK",items}})).status()).toBe(403);
  expect((await page.request.patch(url,{headers,data:{operation:"BULK_STOCK",items}})).status()).toBe(200);
  expect(await remaining()).toBe(8);
  const first=await prisma.stallProduct.findFirstOrThrow({where:{stallId,productId}});
  const second=await prisma.stallProduct.findFirstOrThrow({where:{stallId,productId:secondProductId}});
  const rejected=await page.request.patch(url,{headers,data:{operation:"BULK_STOCK",items:[
    {productId,mode:"SET",quantity:10,expectedVersion:first.stockVersion},
    {productId:secondProductId,mode:"SET",quantity:10,expectedVersion:second.stockVersion+100},
  ]}});
  expect(rejected.status()).toBe(409);expect((await rejected.json()).code).toBe("STOCK_CHANGED");
  expect(await remaining()).toBe(8);
  expect((await page.request.patch(url,{headers,data:{operation:"BULK_STOCK",items:[{productId:randomUUID(),mode:"SET",quantity:10,expectedVersion:0}]}})).status()).toBe(404);
  expect(await remaining()).toBe(8);
});

test("QR edit at zero stock, replay, cancellation and overselling use real transactions",async({page})=>{
  test.setTimeout(180000);
  await prisma.stallProduct.updateMany({where:{stallId,productId},data:{stockRemaining:2}});
  const order=await submit(page,2);
  expect(order.response.status(),order.body.code).toBe(201);expect(await remaining()).toBe(0);
  const replay=await page.request.post("/api/public/orders",{headers:publicHeaders(),data:order.data});
  expect(replay.ok()).toBeTruthy();expect(await remaining()).toBe(0);
  const editData={deviceId:order.data.deviceId,idempotencyKey:randomUUID(),turnstileToken:"XXXX.DUMMY.TOKEN.XXXX",customerName:"庫存驗收",customerPhone:"0912345678",customerNote:"不新增商品",items:[{productId,quantity:2}]};
  const edited=await page.request.patch(`/api/public/orders/${order.body.trackingToken}`,{headers:publicHeaders(),data:editData});
  expect(edited.status(),(await edited.json()).code).toBe(200);expect(await remaining()).toBe(0);
  const more=await page.request.patch(`/api/public/orders/${order.body.trackingToken}`,{headers:publicHeaders(),data:{...editData,idempotencyKey:randomUUID(),items:[{productId,quantity:3}]}});
  expect(more.status()).toBe(409);expect((await more.json()).code).toBe("PRODUCT_STOCK_INSUFFICIENT");expect(await remaining()).toBe(0);
  const cancel=await page.request.delete(`/api/public/orders/${order.body.trackingToken}`,{headers:publicHeaders(),data:{deviceId:order.data.deviceId}});
  expect(cancel.status()).toBe(200);expect(await remaining()).toBe(2);
  await prisma.stallProduct.updateMany({where:{stallId,productId},data:{stockRemaining:1}});
  const attempts=await Promise.all([submit(page,1),submit(page,1)]);
  expect(attempts.filter((a)=>a.response.status()===201)).toHaveLength(1);
  const denied=attempts.find((a)=>a.response.status()!==201)!;
  expect(denied.response.status()).toBe(409);expect(denied.body.code).toBe("PRODUCT_STOCK_INSUFFICIENT");expect(await remaining()).toBe(0);
});

test("special opening permits real preorders and cutoff rejects new QR sessions",async({page})=>{
  test.setTimeout(120000);
  await prisma.stallProduct.updateMany({where:{stallId,productId},data:{stockRemaining:5}});
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const closure=await prisma.stallSpecialClosure.create({data:{organizationId,stallId,startsOn:new Date(today),endsOn:new Date(today),opensAt:"00:00",closesAt:"23:59",title:"特殊營業測試",message:""}});
  try {
    const order=await submit(page,1,"PREORDER");expect(order.response.status(),order.body.code).toBe(201);expect(await remaining()).toBe(4);
    await prisma.stallSpecialClosure.update({where:{id:closure.id},data:{lastOrderAt:"00:00"}});
    const issued=await session(page);expect(issued.response.status()).toBe(409);expect(issued.body.code).toBe("QR_LAST_ORDER_PASSED");
  } finally {await prisma.stallSpecialClosure.delete({where:{id:closure.id}});}
});

test("Edge fallback enforces the same stock transaction and returns a specific conflict",async({page})=>{
  test.setTimeout(120000);
  await prisma.stallProduct.updateMany({where:{stallId,productId},data:{stockRemaining:2}});
  const created=await submit(page,1,"DEFAULT",true);
  expect(created.response.status(),created.body.code).toBe(201);expect(await remaining()).toBe(1);
  const denied=await submit(page,2,"DEFAULT",true);
  expect(denied.response.status()).toBe(409);expect(denied.body.code).toBe("PRODUCT_STOCK_INSUFFICIENT");expect(await remaining()).toBe(1);
});

test("printed table QR survives enabling dine-in, main QR rotation and pause-close-open",async({page})=>{
  test.setTimeout(180000);await establishLocalTestSession(page,prisma,ownerId);
  const settings=await prisma.stallOrderingSettings.findUniqueOrThrow({where:{stallId}});
  const stall=await prisma.stall.findUniqueOrThrow({where:{id:stallId}});
  const previousQr=await prisma.qrCode.findMany({where:{stallId},select:{id:true,state:true}});
  const table=await prisma.diningTable.create({data:{organizationId,stallId,code:("QA-"+randomUUID().slice(0,7)).toUpperCase(),label:"印刷驗收桌"}});
  const token="printed-"+randomUUID();
  const qr=await prisma.qrCode.create({data:{organizationId,stallId,diningTableId:table.id,token,label:"Printed QA",state:"ACTIVE",tokenVersion:9999}});
  try{
    await prisma.stallOrderingSettings.update({where:{stallId},data:{dineInEnabled:false}});
    const denied=await session(page,"DEFAULT",token);expect(denied.response.status()).toBeGreaterThanOrEqual(400);
    await gotoLocalPath(page,`/merchant/stalls/${stallId}/qr-print?target=table&paper=A4&tableId=${table.id}`);
    await expect(page.getByRole("alert")).toContainText("內用點餐尚未開啟");
    await gotoLocalPath(page,`/merchant/stalls/${stallId}/settings/dine-in`);
    await page.getByRole("switch",{name:/內用點餐/}).click();
    const saved=page.waitForResponse((response)=>response.url().endsWith("/modules")&&response.request().method()==="PATCH");
    await page.getByRole("button",{name:"儲存設定",exact:true}).click();
    expect((await saved).status()).toBe(200);
    expect((await session(page,"DEFAULT",token)).response.status()).toBe(201);
    const headers=await merchantHeaders(page);
    for(const action of ["ROTATE_QR","PAUSE","CLOSE","OPEN"]){
      const response=await page.request.patch("/api/stalls/aming-chicken/ordering",{headers,data:{action}});
      expect(response.status()).toBe(200);
    }
    const unchanged=await prisma.qrCode.findUniqueOrThrow({where:{id:qr.id}});
    expect(unchanged.token).toBe(token);expect(unchanged.state).toBe("ACTIVE");
    expect((await session(page,"DEFAULT",token)).response.status()).toBe(201);
  }finally{
    await prisma.publicOrderAttempt.deleteMany({where:{qrCodeId:qr.id}});
    await prisma.orderSession.deleteMany({where:{qrCodeId:qr.id}});
    await prisma.qrCode.delete({where:{id:qr.id}});
    await prisma.diningTable.delete({where:{id:table.id}});
    await prisma.qrCode.deleteMany({where:{stallId,id:{notIn:previousQr.map((row)=>row.id)}}});
    for(const row of previousQr)await prisma.qrCode.update({where:{id:row.id},data:{state:row.state}});
    await prisma.stall.update({where:{id:stallId},data:{orderingState:stall.orderingState,isSoldOut:stall.isSoldOut}});
    await prisma.stallOrderingSettings.update({where:{stallId},data:{dineInEnabled:settings.dineInEnabled}});
  }
});

test("removing the only stall role blocks an existing login and preserves membership history",async({page,browser})=>{
  test.setTimeout(120000);
  const profile=await prisma.profile.create({data:{displayName:"權限驗收",authMigrationRequired:false}});
  const membership=await prisma.stallMembership.create({data:{organizationId,stallId,profileId:profile.id,role:"STAFF"}});
  const context=await browser.newContext({baseURL:process.env.PLAYWRIGHT_APP_URL});
  const memberPage=await context.newPage();
  try{
    await establishLocalTestSession(memberPage,prisma,profile.id);
    expect((await memberPage.request.get("/api/stalls/aming-chicken/orders")).status()).toBe(200);
    await establishLocalTestSession(page,prisma,ownerId);
    const response=await page.request.patch(`/api/merchant/stalls/${stallId}/memberships/${membership.id}`,{headers:await merchantHeaders(page),data:{role:"STAFF",isActive:false}});
    expect(response.status()).toBe(200);
    expect((await memberPage.request.get("/api/stalls/aming-chicken/orders")).status()).toBe(404);
    expect((await prisma.stallMembership.findUniqueOrThrow({where:{id:membership.id}})).isActive).toBe(false);
  }finally{await context.close();await prisma.profile.delete({where:{id:profile.id}});}
});

test("catalog desktop/tablet group board and mobile stock editor render without horizontal overflow",async({page})=>{
  test.setTimeout(180000);await establishLocalTestSession(page,prisma,ownerId);
  await gotoLocalPath(page,`/merchant/catalog?organizationId=${organizationId}`);
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    const board=page.getByRole("region",{name:"商品批次管理"});
    await expect(board.getByRole("button",{name:"全部商品庫存",exact:true})).toBeVisible();
    if(width>=768) await expect(page.getByTestId("catalog-management-row").first()).toBeVisible();
    else await expect(page.getByTestId("open-catalog-navigator")).toBeVisible();
    await page.screenshot({path:`test-results/catalog-board-${width}.png`,fullPage:false});
    await board.getByRole("button",{name:"全部商品庫存",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:/庫存份數/});await expect(dialog).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await page.screenshot({path:`test-results/catalog-operations-${width}.png`,fullPage:false});
    if(width===768){
      await dialog.getByRole("combobox",{name:"庫存方式 庫存驗收餐",exact:true}).selectOption("SET");
      await dialog.getByRole("spinbutton",{name:"庫存份數 庫存驗收餐",exact:true}).fill("3");
      const saved=page.waitForResponse((response)=>response.url().endsWith("/products")&&response.request().method()==="PATCH");
      await dialog.getByRole("button",{name:/^儲存庫存/}).click();expect((await saved).status()).toBe(200);
      expect(await remaining()).toBe(3);await expect(dialog).not.toBeVisible();
      await board.getByRole("checkbox",{name:"選取 庫存驗收餐",exact:true}).check();
      const marked=page.waitForResponse((response)=>response.url().endsWith("/products")&&response.request().method()==="PATCH");
      await board.getByRole("button",{name:"批次售完",exact:true}).click();expect((await marked).status()).toBe(200);
      await board.getByRole("button",{name:/^已售完/}).click();
      await expect(board.getByTestId("catalog-management-row").filter({hasText:"庫存驗收餐"})).toBeVisible();
      await board.getByRole("button",{name:/^已售完/}).click();
      continue;
    }
    await dialog.getByRole("button",{name:"關閉庫存設定"}).click();
  }
});
