import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import path from "node:path";

let browser: Browser;
let javascript: string;

// A browser scenario includes page setup and several actions; missing controls still fail within five seconds.
vi.setConfig({ testTimeout: 15_000 });

beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import { StrictMode } from 'react';
        import { createRoot } from 'react-dom/client';
        import { SupplyLiteManager } from './src/components/supply-lite-manager';
        const products = Array.from({length:25}, (_,i) => ({id:'p'+i, name:'商品 '+String(i+1).padStart(2,'0'), kind:'SINGLE', defaultPrice:100}));
        const dashboard = {
          asOfDate:'2026-10-02', suppliers:[], locations:[], balances:[], stalls:[], inventoryLots:[], purchaseOrders:[], recentMovements:[], inventoryValueAmount:0, lotCoverageGapCount:0,
          ingredients:[{id:'i1',name:'麵粉',code:'FLOUR',baseUom:'G',itemType:'INGREDIENT',trackExpiry:false,defaultShelfLifeDays:null,preferredSupplierId:null,lowStockThresholdMicros:'0',totalQuantityMicros:'1000000',lowStock:false}],
          products,
          recipeComponents:products.flatMap((p,i)=>i===22?[]:[{id:'r'+i,productId:p.id,ingredientId:'i1',quantityMicros:'1000000',wasteBasisPoints:0}]),
          productCosts:products.map((p,i)=>({productId:p.id,productName:p.name,sellingPrice:100,recipeCostMicros:i===22?'0':'40000000',recipeCostAmount:i===22?0:40,grossProfit:i===22?100:60,grossMarginBasisPoints:i===22?10000:6000,recipeComplete:i!==22})),
        };
        window.nextDashboard=dashboard;
        window.commands=[];
        window.fetch=async (url, options)=>{window.commands.push({url,body:JSON.parse(options.body)});return Response.json(window.nextDashboard);};
        const root=createRoot(document.getElementById('root'));
        const many = Array.from({length:25},(_,i)=>i);
        const largeDashboard={...dashboard,
          ingredients:many.map(i=>({...dashboard.ingredients[0],id:'i'+(i+1),name:i===0?'麵粉':'品項 '+(i+1),code:'ING'+i,totalQuantityMicros:i===24?'0':'1000000',lowStockThresholdMicros:i>=23?'2000000':'0',lowStock:i>=23})),
          suppliers:many.map(i=>({id:'s'+i,name:'廠商 '+i,code:'SUP'+i,paymentTermsDays:30,leadTimeDays:1})),
          locations:many.map(i=>({id:'l'+i,name:'庫位 '+i,code:'LOC'+i,locationType:'CENTRAL',stallId:null})),
          inventoryLots:many.map(i=>({id:'lot'+i,ingredientId:'i1',lotNumber:'LOT'+i,remainingQuantityMicros:'1000000',expiresOn:i<8?'2026-10-01':i<16?'2026-10-05':'2026-12-01'})),
          purchaseOrders:many.map(i=>({id:'po'+i,documentNumber:'PO'+i,totalAmount:100,supplierName:'廠商 0',orderedOn:'2026-10-02',lineCount:1})),
          recentMovements:many.map(i=>({id:'m'+i,ingredientId:'i1',locationId:'l0',movementType:'ADJUSTMENT',reason:'紀錄 '+i,quantityDeltaMicros:'1000000',createdAt:'2026-10-02T00:00:00.000Z'})),
        };
        window.showLargeData=(organizationId='org-large')=>{window.nextDashboard=largeDashboard;root.render(<StrictMode><SupplyLiteManager organizationId={organizationId} initialDashboard={largeDashboard}/></StrictMode>);};
        window.switchOrganization=()=>root.render(<StrictMode><SupplyLiteManager organizationId="org-b" initialDashboard={{...dashboard,products:[{...products[0],name:'新組織商品'}],recipeComponents:[],productCosts:[{...dashboard.productCosts[0],productName:'新組織商品'}]}}/></StrictMode>);
        root.render(<StrictMode><SupplyLiteManager organizationId="org-a" initialDashboard={dashboard}/></StrictMode>);
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    alias: { "@": path.resolve("src") },
  });
  javascript = result.outputFiles[0].text;
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => { await browser?.close(); });

async function mounted() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://supply.test");
  await page.addScriptTag({ content: javascript });
  await page.getByRole("heading", { name: "商品配方毛利", exact: true }).waitFor();
  return page;
}

function margins(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "商品配方毛利", exact: true }) });
}

function recipes(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "商品配方項目", exact: true }) });
}

it("bounds the initial product list without hiding the unconfigured-product count", async () => {
  const page = await mounted();
  try {
    expect(await margins(page).locator("article").count()).toBe(6);
    expect(await margins(page).getByText("尚未建立配方：1 件", { exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "商品配方毛利下一頁", exact: true }).click();
    expect(await margins(page).getByText("商品 07", { exact: true }).count()).toBe(1);
    expect(await margins(page).getByText("商品 01", { exact: true }).count()).toBe(0);
  } finally { await page.close(); }
});

it("keeps recipe paging independent and removes the selected last-page recipe through its existing command", async () => {
  const page = await mounted();
  try {
    expect(await recipes(page).locator('[data-testid^="manage-supply-recipe-"]').count()).toBe(6);
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "商品配方項目下一頁", exact: true }).click();
    expect(await recipes(page).locator('[data-testid^="manage-supply-recipe-"]').count()).toBe(6);
    expect(await page.getByRole("button", { name: "商品配方項目下一頁", exact: true }).isDisabled()).toBe(true);
    expect(await margins(page).getByText("商品 01", { exact: true }).count()).toBe(1);
    await page.getByTestId("manage-supply-recipe-r24").click();
    await page.getByRole("button", { name: "移除配方", exact: true }).click();
    await page.evaluate(() => {
      const state = window as unknown as { nextDashboard: { recipeComponents: unknown[] } };
      state.nextDashboard = { ...state.nextDashboard, recipeComponents: state.nextDashboard.recipeComponents.slice(0, 1) };
    });
    await page.getByRole("button", { name: "確認移除", exact: true }).click();
    await page.getByText("配方項目已移除。", { exact: true }).waitFor();
    expect(await page.getByTestId("manage-supply-recipe-r0").count()).toBe(1);
    expect(await page.getByRole("button", { name: "商品配方項目上一頁", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands)).toEqual([
      { url: "/api/merchant/organizations/org-a/supply", body: { operation: "REMOVE_RECIPE_COMPONENT", componentId: "r24" } },
    ]);
  } finally { await page.close(); }
});

it("searches all loaded products, retains the missing-recipe warning, and resets paging when cleared", async () => {
  const page = await mounted();
  try {
    await page.getByRole("button", { name: "商品配方毛利下一頁", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("searchbox", { name: "搜尋毛利商品", exact: true }).fill(" 商品 23 ");
    expect(await margins(page).locator("article").count()).toBe(1);
    expect(await margins(page).getByText("商品 23", { exact: true }).count()).toBe(1);
    expect(await margins(page).getByText("尚未建立配方，毛利不可採信。", { exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "商品配方毛利下一頁", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("searchbox", { name: "搜尋毛利商品", exact: true }).fill("查無此商品");
    expect(await margins(page).locator("article").count()).toBe(0);
    expect(await margins(page).getByText("找不到符合的商品，請調整搜尋。", { exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "清除商品配方毛利搜尋", exact: true }).click();
    expect(await margins(page).locator("article").count()).toBe(6);
    expect(await margins(page).getByText("商品 01", { exact: true }).count()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands)).toEqual([]);
  } finally { await page.close(); }
});

it("searches recipe product and ingredient names independently from margin search", async () => {
  const page = await mounted();
  try {
    await page.getByRole("searchbox", { name: "搜尋毛利商品", exact: true }).fill("商品 23");
    await page.getByRole("button", { name: "商品配方項目下一頁", exact: true }).click();
    await page.getByRole("searchbox", { name: "搜尋配方商品或食材", exact: true }).fill("商品 24");
    expect(await page.getByTestId("manage-supply-recipe-r23").count()).toBe(1);
    expect(await recipes(page).locator('[data-testid^="manage-supply-recipe-"]').count()).toBe(1);
    await page.getByRole("searchbox", { name: "搜尋配方商品或食材", exact: true }).fill("麵粉");
    expect(await recipes(page).locator('[data-testid^="manage-supply-recipe-"]').count()).toBe(6);
    expect(await page.getByTestId("manage-supply-recipe-r0").count()).toBe(1);
    expect(await margins(page).getByText("商品 23", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
});

it("resets data, searches, pages and open record state when the authorized organization changes", async () => {
  const page = await mounted();
  try {
    await page.getByRole("searchbox", { name: "搜尋毛利商品", exact: true }).fill("商品 23");
    await page.getByRole("button", { name: "商品配方項目下一頁", exact: true }).click();
    await page.getByTestId("manage-supply-recipe-r6").click();
    await page.evaluate(() => (window as unknown as { switchOrganization: () => void }).switchOrganization());
    await margins(page).getByText("新組織商品", { exact: true }).waitFor();
    expect(await page.getByRole("searchbox", { name: "搜尋毛利商品", exact: true }).inputValue()).toBe("");
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.locator('[data-testid^="manage-supply-recipe-"]').count()).toBe(0);
    expect(await page.getByText("商品 23", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "商品配方項目上一頁", exact: true }).isDisabled()).toBe(true);
  } finally { await page.close(); }
});

it("bounds every large inventory/history list independently and preserves full warning totals", async () => {
  const page = await mounted();
  try {
    await page.evaluate(() => (window as unknown as { showLargeData: () => void }).showLargeData());
    await page.getByTestId("manage-supply-supplier-s0").waitFor();
    expect(await page.locator('[data-testid^="manage-supply-ingredient-"]').count()).toBe(6);
    const areas = [
      ["批號與新鮮度", "div.mt-3 > div"], ["最近進貨單", "div.mt-3 > div"],
      ["食材、包材、耗材與器具庫存", '[data-testid^="manage-supply-ingredient-"]'],
      ["進貨廠商", '[data-testid^="manage-supply-supplier-"]'],
      ["庫位", '[data-testid^="manage-supply-location-"]'], ["最近庫存流水", "article"],
    ];
    for (const [name, selector] of areas) {
      const heading = page.getByRole("heading", { name, exact: true });
      const area = heading.locator("..");
      expect(await area.getByText("目前清單 25 件 · 顯示 6 件", { exact: true }).count()).toBe(1);
      const records = name === "批號與新鮮度" || name === "最近進貨單"
        ? area.locator("div.space-y-2 > div") : area.locator(selector);
      expect(await records.count()).toBe(6);
      await page.getByRole("button", { name: `顯示更多${name}`, exact: true }).click();
      expect(await area.getByText("目前清單 25 件 · 顯示 12 件", { exact: true }).count()).toBe(1);
      expect(await records.count()).toBe(12);
      await page.getByRole("button", { name: `收合${name}`, exact: true }).click();
      expect(await area.getByText("目前清單 25 件 · 顯示 6 件", { exact: true }).count()).toBe(1);
      expect(await records.count()).toBe(6);
    }
    expect(await page.getByText("已逾期：8 批 · 7 天內到期：8 批", { exact: true }).count()).toBe(1);
    expect(await page.getByText("低庫存：2 件", { exact: true }).count()).toBe(1);
    expect(await page.getByTestId("manage-supply-ingredient-i25").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands)).toEqual([]);
  } finally { await page.close(); }
});

it.each([
  ["食材、包材、耗材與器具庫存", "ingredient", "i25", "ARCHIVE_INGREDIENT", "ingredientId"],
  ["進貨廠商", "supplier", "s24", "ARCHIVE_SUPPLIER", "supplierId"],
  ["庫位", "location", "l24", "ARCHIVE_LOCATION", "locationId"],
])("keeps %s expanded record identity through its existing command and resets after refresh", async (label, kind, id, operation, idKey) => {
  const page = await mounted();
  try {
    await page.evaluate(() => (window as unknown as { showLargeData: () => void }).showLargeData());
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: `顯示更多${label}`, exact: true }).click();
    expect(await page.getByRole("button", { name: `顯示更多${label}`, exact: true }).isDisabled()).toBe(true);
    await page.getByTestId(`manage-supply-${kind}-${id}`).click();
    await page.getByRole("button", { name: "停用資料", exact: true }).click();
    await page.evaluate(({ kind, id }) => {
      const state = window as unknown as { nextDashboard: Record<string, { id: string }[]> };
      const key = kind === "ingredient" ? "ingredients" : kind === "supplier" ? "suppliers" : "locations";
      state.nextDashboard = { ...state.nextDashboard, [key]: state.nextDashboard[key].filter((row) => row.id !== id) };
    }, { kind, id });
    await page.getByRole("button", { name: "確認停用", exact: true }).click();
    await page.getByText("資料已安全停用，歷史紀錄仍保留。", { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands)).toEqual([
      { url: "/api/merchant/organizations/org-large/supply", body: { operation, [idKey]: id } },
    ]);
    expect(await page.locator(`[data-testid^="manage-supply-${kind}-"]`).count()).toBe(6);
    expect(await page.getByRole("button", { name: `收合${label}`, exact: true }).isDisabled()).toBe(true);
  } finally { await page.close(); }
});

it("resets all expanded sections when the organization changes", async () => {
  const page = await mounted();
  try {
    await page.evaluate(() => (window as unknown as { showLargeData: () => void }).showLargeData());
    const labels = ["批號與新鮮度", "最近進貨單", "食材、包材、耗材與器具庫存", "進貨廠商", "庫位", "最近庫存流水"];
    for (const label of labels) await page.getByRole("button", { name: `顯示更多${label}`, exact: true }).click();
    await page.evaluate(() => (window as unknown as { showLargeData: (org: string) => void }).showLargeData("org-other"));
    for (const label of labels) {
      const area = page.getByRole("heading", { name: label, exact: true }).locator("..");
      expect(await area.getByText("目前清單 25 件 · 顯示 6 件", { exact: true }).count()).toBe(1);
      expect(await page.getByRole("button", { name: `收合${label}`, exact: true }).isDisabled()).toBe(true);
    }
  } finally { await page.close(); }
});
