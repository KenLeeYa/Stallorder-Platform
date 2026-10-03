import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { compile } from "@tailwindcss/node";

vi.setConfig({ testTimeout: 20_000 });
let browser: Browser;
let javascript: string;
beforeAll(async () => {
  const result = await build({ stdin: { contents: `
    import { StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { LocaleProvider } from './src/components/locale-provider';
    import { MerchantMessagesProvider } from './src/lib/messages/merchant-client';
    import { OperatingProfitDashboard } from './src/components/operating-profit-dashboard';
    import { WorkforceManager } from './src/components/workforce-manager';
    import { StallScheduleManager } from './src/components/stall-schedule-manager';
    import { MerchantEInvoiceManager } from './src/components/merchant-e-invoice-manager';
    import { MobileProgressiveRecords } from './src/components/mobile-progressive-records';
    import { invoiceProviderDefinitions } from './src/server/e-invoice/provider-definitions';
    const rows=Array.from({length:19},(_,i)=>i);
    const otherRows=rows.map(i=>i+100);
    const dates={dateFrom:'2026-10-01',dateTo:'2026-10-19'};
    const profit={...dates,stalls:[{id:'stall-a',name:'攤位甲'}],summary:{netSales:123456,grossProfit:0,grossMarginBasisPoints:0,foodCost:0,packagingCost:0,payrollCost:0,laborCostBasisPoints:0,operatingExpenseAmount:0,operatingProfit:0,operatingProfitBasisPoints:0,netCashMovement:0,inventoryValue:0,cashCollected:0,purchaseSpend:0,primeCostBasisPoints:0,wasteCost:0,sharedOperatingExpenseAmount:0,sharedPurchaseSpend:0},dataQuality:{missingRecipeProducts:19},customExpenseCategoryNames:[],
      expenses:rows.map(i=>({id:'expense'+i,expenseDate:'2026-10-02',stallId:'stall-a',category:'RENT',customCategoryName:null,amount:100,description:'支出 '+i,vendorName:'供應商',isRecurring:false})),
      expenseCategories:rows.map(i=>({category:'OTHER',customCategoryName:'分類 '+i,amount:100})),
      dailySales:rows.map(i=>({businessDate:'2026-10-'+String(i+1).padStart(2,'0'),netSales:100})),
      productMargins:rows.map(i=>({productId:'p'+i,productName:'商品 '+i,quantity:1,revenue:100,foodCost:10,packagingCost:5,estimatedCost:15,grossProfit:85,grossMarginBasisPoints:8500}))};
    const workforce={...dates,employees:[],totals:{payableMinutes:1900,grossAmount:98765,pendingLeaveCount:19,missingWageRateCount:1},
      payrollPreview:rows.map(i=>({profileId:'person'+i,profileName:'員工 '+i,hourlyRate:200,shifts:[],grossAmount:100,regularMinutes:60,overtimeTier1Minutes:0,overtimeTier2Minutes:0,holidayMinutes:0,overtimeAmount:0,holidayAmount:0,missingWageRate:i===18})),
      anomalies:rows.map(i=>({profileName:'員工 '+i,stallName:'攤位甲',message:'待覆核 '+i,occurredAt:'2026-10-02T00:00:00Z'})),
      schedules:rows.map(i=>({id:'ws'+i,profileName:'員工 '+i,workDate:'2026-10-02',status:'PUBLISHED',dayType:'WORKDAY',shiftStartAt:null,shiftEndAt:null})),
      leaveRequests:rows.map(i=>({id:'leave'+i,profileName:'員工 '+i,leaveType:'ANNUAL',startDate:'2026-10-02',endDate:'2026-10-03',status:'PENDING',reason:'請假'})),
      payrollPeriods:rows.slice(0,12).map(i=>({id:'pay'+i,periodStart:'2026-09-01',periodEnd:'2026-09-30',lines:[],totalGrossAmount:100,status:'DRAFT'})),payrollPolicy:{}};
    const location={id:'location-a',name:'市場甲',address:'測試街道',isActive:true};
    const schedule={stall:{id:'stall-a',name:'攤位甲',timezone:'Asia/Taipei',slug:'stall-a'},capabilities:{scheduleLimit:19,recurringCopy:true,automaticOrdering:false,eventSchedule:false},locations:[location],events:[],qrCodes:[],
      schedules:rows.map(i=>({id:'schedule'+i,locationId:location.id,marketEventId:null,startsAt:'2026-10-'+String(i+1).padStart(2,'0')+'T00:00:00Z',endsAt:'2026-10-'+String(i+1).padStart(2,'0')+'T12:00:00Z',orderingOpensAt:null,orderingClosesAt:null,status:'SCHEDULED',specialNotice:'行程 '+i,menuOverrideId:null,autoOpenEnabled:false,autoCloseEnabled:false,location,marketEvent:null}))};
    const invoice={readiness:'LOCAL_MOCK_READY',devMode:true,productionIssueEnabled:false,flags:{},seller:null,connections:[],policies:[],providers:invoiceProviderDefinitions,eligibleOrders:[],
      documents:rows.map(i=>({id:'doc'+i,orderId:'order'+i,orderNo:String(i),provider:'ECPAY',environment:'MOCK',documentType:'INVOICE',status:'ISSUED',buyerType:'CLOUD',totalAmount:100,taxAmount:5,allowedAmount:0,currency:'TWD',externalInvoiceNumber:'TEST'+i,issuedAt:null,paymentStatus:'PAID',reconciliationStatus:'PENDING',testDocument:true,operations:[],reconciliationCases:i===18?[{id:'case18',caseType:'AMOUNT_MISMATCH',reviewStatus:'OPEN'}]:[]}))};
    const root=createRoot(document.getElementById('root'));
    window.mountRecords=(scope,version)=>root.render(<StrictMode><MobileProgressiveRecords items={version==='a'?rows:otherRows} scopeKey={scope} label="測試紀錄">{records=><div data-testid="helper-records">{records.map(i=><p key={i}>{i}</p>)}</div>}</MobileProgressiveRecords></StrictMode>);
    window.commands=[];
    window.mount=(kind,scope='org-a',dateTo=dates.dateTo,canManageExpenses=true)=>{
      const data={profit,workforce,schedule,invoice}[kind]; window.current={kind,scope,dateTo}; window.nextDashboard={...data,dateTo};
      const props=kind==='schedule'?{stallId:scope,initialData:window.nextDashboard}:kind==='invoice'?{organizationId:scope,initialData:window.nextDashboard}:{organizationId:scope,initialDashboard:window.nextDashboard};
      const Component={profit:OperatingProfitDashboard,workforce:WorkforceManager,schedule:StallScheduleManager,invoice:MerchantEInvoiceManager}[kind];
      root.render(<StrictMode><LocaleProvider initialLocale="zh-TW" hasLocaleCookie={true}><MerchantMessagesProvider messages={new Proxy({},{get:(_,k)=>String(k)})}><Component {...props} canManageExpenses={canManageExpenses} availableStalls={profit.stalls} multiStallMode={false}/></MerchantMessagesProvider></LocaleProvider></StrictMode>);
    };
    window.fetch=async(url,options)=>{window.commands.push({url,body:JSON.parse(options.body)});return Response.json(window.nextDashboard);};
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' }, alias: { "@": path.resolve("src") } });
  javascript = result.outputFiles[0].text;
  browser = await chromium.launch();
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function mounted(kind: string, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://127.0.0.1:39999");
  await page.addScriptTag({ content: javascript });
  if (errors.length) throw new Error(errors.join("\n"));
  await page.evaluate(kind => (window as unknown as { mount: (kind: string) => void }).mount(kind), kind);
  await page.locator("h2").first().waitFor();
  return page;
}

const primary = [
  ["profit", '[data-testid="operating-profit-product-margins"] tbody tr', "商品毛利排行"],
  ["workforce", 'section:has(h2:text-is("本期薪資預覽")) article', "本期薪資預覽"],
  ["schedule", '[aria-labelledby="schedule-actions-title"] article', "行程與現場狀態"],
  ["invoice", 'section:has(h2:text-is("電子發票紀錄")) article', "電子發票紀錄"],
];
it("wraps provider status codes within the real invoice layout at narrow widths", async () => {
  const page = await mounted("invoice", 320);
  try {
    const compiler = await compile(readFileSync("src/app/globals.css", "utf8"), { base: path.resolve("src/app"), onDependency: () => undefined });
    const source = ["src/components/merchant-e-invoice-manager.tsx", "src/components/mobile-progressive-records.tsx"].map(file => readFileSync(file, "utf8")).join(" ");
    const candidates = [...source.matchAll(/className="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/));
    await page.addStyleTag({ content: compiler.build([...candidates, "px-4"]) });
    await page.locator("#root").evaluate(element => element.setAttribute("class", "px-4"));
    const area = page.getByRole("heading", { name: "正式供應商狀態", exact: true }).locator("..");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await browserExpect(area.getByText("OFFICIAL_DOWNLOAD_REQUIRED", { exact: true })).toHaveCount(1);
      await browserExpect(area.getByText("TRADEVAN_EINVOICE_CONTRACT_NOT_VERIFIED", { exact: true })).toHaveCount(1);
      const geometry = await area.evaluate(element => {
        return { page: document.documentElement.scrollWidth, viewport: window.innerWidth, area: element.getBoundingClientRect().right, cards: [...element.querySelectorAll("article")].map(card => ({ right: card.getBoundingClientRect().right, scroll: card.scrollWidth, width: card.clientWidth })) };
      });
      expect(geometry.page, `page overflow at ${width}`).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.cards).toHaveLength(3);
      for (const card of geometry.cards) {
        expect(card.right, `card overflow at ${width}`).toBeLessThanOrEqual(geometry.area);
        expect(card.scroll, `text overflow at ${width}`).toBeLessThanOrEqual(card.width);
      }
    }
  } finally { await page.close(); }
});
it.each(primary)("bounds the real %s mobile record surface", async (kind, selector, label) => {
  const page = await mounted(kind);
  try {
    await browserExpect(page.locator(selector)).toHaveCount(6);
    await page.getByRole("button", { name: `顯示更多${label}`, exact: true }).click();
    await browserExpect(page.locator(selector)).toHaveCount(12);
    await page.getByRole("button", { name: `收合${label}`, exact: true }).click();
    await browserExpect(page.locator(selector)).toHaveCount(6);
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await browserExpect(page.locator(selector)).toHaveCount(19);
      await browserExpect(page.getByRole("button", { name: `顯示更多${label}`, exact: true })).toHaveCount(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await browserExpect(page.locator(selector)).toHaveCount(6);
    await page.getByRole("button", { name: `顯示更多${label}`, exact: true }).click();
    await page.evaluate(kind => (window as unknown as { mount: (kind: string, scope: string, date: string) => void }).mount(kind, "org-b", "2026-10-20"), kind);
    await browserExpect(page.locator(selector)).toHaveCount(6);
    expect(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands)).toEqual([]);
  }
  finally { await page.close(); }
});

it.each(["data", "scope"])("resets same-reference A-B-A %s roundtrips", async boundary => {
  const page = await mounted("invoice");
  try {
    const mount = (scope: string, version: string) => page.evaluate(([scope, version]) =>
      (window as unknown as { mountRecords: (scope: string, version: string) => void }).mountRecords(scope, version), [scope, version]);
    await mount("a", "a");
    const records = page.locator('[data-testid="helper-records"] p');
    await browserExpect(records).toHaveCount(6);
    await page.getByRole("button", { name: "顯示更多測試紀錄" }).click();
    await browserExpect(records).toHaveCount(12);
    await mount(boundary === "scope" ? "b" : "a", boundary === "data" ? "b" : "a");
    await browserExpect(records).toHaveCount(6);
    await mount("a", "a");
    await browserExpect(records).toHaveCount(6);
  } finally { await page.close(); }
});

async function revealAll(page: Page, label: string) {
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: `顯示更多${label}`, exact: true }).click();
  await browserExpect(page.getByRole("button", { name: `顯示更多${label}`, exact: true })).toBeDisabled();
}
async function commands(page: Page) {
  return page.evaluate(() => (window as unknown as { commands: { url: string; body: Record<string, unknown> }[] }).commands);
}

it("bounds all profit collections while retaining complete totals and exact expense correction identity", async () => {
  const page = await mounted("profit");
  try {
    await browserExpect(page.getByRole("region", { name: "營運損益摘要" })).toContainText("123,456");
    await browserExpect(page.getByText("19 個已售商品缺少配方", { exact: true })).toBeVisible();
    expect(await page.locator('[data-testid^="correct-operating-expense-"]').count()).toBe(6);
    expect(await page.locator('[data-testid="operating-profit-expense-categories"] div.space-y-2 > div').count()).toBe(6);
    expect(await page.locator('[data-testid="operating-profit-daily-sales"] div.grid > div').count()).toBe(6);
    await revealAll(page, "已入帳支出");
    await page.getByTestId("correct-operating-expense-expense18").click();
    const dialog=page.getByRole("dialog", { name: "更正已入帳支出" });
    await browserExpect(dialog.getByLabel("支出說明", { exact: true })).toHaveValue("支出 18");
    await dialog.getByLabel("更正原因", { exact: true }).fill("測試更正原因");
    await dialog.getByRole("button", { name: "儲存更正", exact: true }).click();
    await page.getByText("支出已更正；原紀錄與更正原因均已保留。損益與現金統計已重新計算。", { exact: true }).waitFor();
    expect((await commands(page))[0]).toMatchObject({ url: "/api/merchant/organizations/org-a/operating-profit?dateFrom=2026-10-01&dateTo=2026-10-19&stallId=stall-a", body: { operation: "CORRECT_EXPENSE", expenseId: "expense18", description: "支出 18" } });
    expect(await page.locator('[data-testid^="correct-operating-expense-"]').count()).toBe(6);
    await browserExpect(page.getByRole("region", { name: "營運損益摘要" })).toContainText("123,456");
  } finally { await page.close(); }
});

it("retains workforce totals and hidden-row wage warning while targeting the correct leave request", async () => {
  const page = await mounted("workforce");
  try {
    for (const label of ["班表安排", "休假申請", "薪資單歷程"]) {
      const area=page.getByRole("heading", { name: label, exact: true }).locator("..");
      expect(await area.locator("article").count()).toBe(6);
    }
    expect(await page.getByRole("heading", { name: "工時覆核提醒" }).locator("..").locator("li").count()).toBe(6);
    await browserExpect(page.getByRole("region", { name: "員工薪資摘要" })).toContainText("19／19");
    await browserExpect(page.getByText("缺少有效時薪：1 人", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "產生本期薪資單" })).toBeDisabled();
    await revealAll(page, "休假申請");
    const last=page.getByRole("heading", { name: "休假申請", exact: true }).locator("..").locator("article").last();
    await browserExpect(last).toContainText("員工 18");
    await last.getByRole("button", { name: "核准", exact: true }).click();
    await page.getByText("休假申請已核准。", { exact: true }).waitFor();
    expect((await commands(page))[0].body).toEqual({ operation: "REVIEW_LEAVE", leaveRequestId: "leave18", decision: "APPROVED", reviewNote: null });
    expect(await page.getByRole("heading", { name: "休假申請", exact: true }).locator("..").locator("article").count()).toBe(6);
  } finally { await page.close(); }
});

it("retains schedule entitlement aggregate and the selected expanded schedule action", async () => {
  const page = await mounted("schedule");
  try {
    await browserExpect(page.getByRole("button", { name: "建立行程", exact: true })).toBeDisabled();
    await revealAll(page, "行程與現場狀態");
    await page.getByLabel("操作原因（狀態、複製、QR 綁定必填）", { exact: true }).fill("本機回歸測試");
    const last=page.locator('[aria-labelledby="schedule-actions-title"] article').last();
    await browserExpect(last).toContainText("行程 18");
    await last.getByRole("button", { name: "立即開攤", exact: true }).click();
    await last.getByRole("button", { name: "確認立即開攤", exact: true }).click();
    await browserExpect(page.locator('[aria-labelledby="schedule-actions-title"] article')).toHaveCount(6);
    expect((await commands(page))[0]).toMatchObject({ url: "/api/merchant/stalls/org-a/schedule", body: { operation: "SET_STATUS", scheduleId: "schedule18", status: "OPEN", reason: "本機回歸測試" } });
  } finally { await page.close(); }
});

it("retains invoice difference count and queries the exact expanded document", async () => {
  const page = await mounted("invoice");
  try {
    await browserExpect(page.getByText("對帳差異紀錄：1 筆", { exact: true })).toBeVisible();
    await revealAll(page, "電子發票紀錄");
    const last=page.getByRole("heading", { name: "電子發票紀錄" }).locator("..").locator("article").last();
    await browserExpect(last).toContainText("#18");
    await last.getByRole("button", { name: "查詢", exact: true }).click();
    await page.getByText("本機 Mock 操作已完成；這不是合法電子發票。", { exact: true }).waitFor();
    expect((await commands(page))[0]).toMatchObject({ url: "/api/merchant/organizations/org-a/e-invoice", body: { operation: "QUERY", invoiceDocumentId: "doc18" } });
    expect(await page.getByRole("heading", { name: "電子發票紀錄" }).locator("..").locator("article").count()).toBe(6);
  } finally { await page.close(); }
});

it("keeps finance read-only controls absent and resets the actual report date scope", async () => {
  const page = await mounted("profit");
  try {
    await page.evaluate(() => (window as unknown as { mount: (kind: string, scope: string, date: string, canManage: boolean) => void }).mount("profit", "org-b", "2026-10-20", false));
    await browserExpect(page.locator('[data-testid^="correct-operating-expense-"]')).toHaveCount(0);
    await browserExpect(page.locator('input[name="dateTo"]')).toHaveValue("2026-10-20");
    expect(await commands(page)).toEqual([]);
  } finally { await page.close(); }
});
