import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "@playwright/test";
import path from "node:path";

let browser: Browser;
let javascript: string;
beforeAll(async () => {
  const result = await build({ stdin: { contents: `
    import { createRoot } from 'react-dom/client';
    import { NotificationInbox, NotificationUnreadStatus } from './src/components/notification-inbox';
    window.count=0; window.status=200; window.requests=[];
    const item={source:'BILLING',id:'33333333-3333-4333-8333-333333333333',category:'BILLING',createdAt:'2026-10-01T00:00:00.000Z',readAt:null,title:'Private billing notification',message:'Private billing detail',target:{kind:'BILLING_HOME',organizationId:'11111111-1111-4111-8111-111111111111'}};
    window.fetch=async url=>{
      window.requests.push(url);
      let body={version:'v1',unreadCount:window.count,from:'2026-10-01T00:00:00.000Z',to:'2026-10-02T00:00:00.000Z'};
      if(window.inbox){
        if(url==='/api/notification-preferences') body={version:'v1',preferences:{version:1,billingVisible:true,applicationVisible:true,staffOrderVisible:true,analyticsConsent:false}};
        else if(url.startsWith('/api/notifications?')) body={...body,items:[item],nextCursor:null};
        else body={version:'v1',item};
      }
      return Response.json(body,{status:window.status});
    };
    const root=createRoot(document.getElementById('root'));
    window.mount=(identity,organizationId)=>root.render(<NotificationUnreadStatus identity={identity} scope={{kind:'ORGANIZATION',organizationId}}/>);
    window.mountInbox=()=>{window.inbox=true;root.render(<NotificationInbox identity='session-inbox' scope={{kind:'ORGANIZATION',organizationId:'11111111-1111-4111-8111-111111111111'}}/>);};
    window.mount('session-a','11111111-1111-4111-8111-111111111111');
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, alias: { "@": path.resolve("src") } });
  javascript = result.outputFiles[0].text;
  browser = await chromium.launch();
}, 30_000);
afterAll(async () => { await browser?.close(); });

it("refreshes 0 to unread on focus, clears private count on denied access and remounts the new scope", async () => {
  const page = await browser.newPage();
  try {
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://inbox.test");
    await page.addScriptTag({ content: javascript });
    await page.getByLabel("0 則未讀通知").waitFor();
    await page.evaluate(() => { Object.assign(window, { count: 3 }); window.dispatchEvent(new Event("focus")); });
    await page.getByLabel("3 則未讀通知").waitFor();
    await page.evaluate(() => { Object.assign(window, { status: 401 }); window.dispatchEvent(new Event("focus")); });
    await page.waitForFunction(() => !document.querySelector("b"));
    expect(await page.getByLabel("3 則未讀通知").count()).toBe(0);
    await page.evaluate(() => { const w = window as unknown as { status: number; count: number; mount: (identity: string, org: string) => void }; w.status = 200; w.count = 1; w.mount("session-b", "22222222-2222-4222-8222-222222222222"); });
    await page.getByLabel("1 則未讀通知").waitFor();
    expect(await page.evaluate(() => (window as unknown as { requests: string[] }).requests.at(-1))).toContain("22222222-2222-4222-8222-222222222222");
  } finally { await page.close(); }
});

it("clicking apply refetches unchanged filters and clears mounted private content on 401", async () => {
  const page = await browser.newPage();
  try {
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://inbox.test");
    await page.addScriptTag({ content: javascript });
    await page.evaluate(() => (window as unknown as { mountInbox: () => void }).mountInbox());
    const list = page.getByRole("region", { name: "通知列表", exact: true });
    await list.waitFor();
    const requests = () => page.evaluate(() => (window as unknown as { requests: string[] }).requests.filter(url => url.startsWith("/api/notifications?")));
    const before = await requests();
    await page.getByRole("button", { name: "套用篩選", exact: true }).click();
    await page.waitForFunction(count => (window as unknown as { requests: string[] }).requests.filter(url => url.startsWith("/api/notifications?")).length === count + 1, before.length, { timeout: 5_000 });
    expect((await requests()).at(-1)).toBe(before.at(-1));
    await page.locator('select[name="category"]').selectOption("BILLING");
    await page.getByRole("button", { name: "套用篩選", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { requests: string[] }).requests.some(url => url.includes("category=BILLING")), undefined, { timeout: 3_000 });
    expect(new URL((await requests()).at(-1)!, "http://inbox.test").searchParams.get("category")).toBe("BILLING");
    await list.getByRole("button").filter({ hasText: "Private billing notification" }).click();
    const detail = page.getByRole("region", { name: "通知詳情", exact: true });
    await detail.waitFor();
    await page.evaluate(() => { (window as unknown as { status: number }).status = 401; });
    await page.getByRole("button", { name: "套用篩選", exact: true }).click();
    await page.getByText("登入或權限已變更，通知內容已清除。", { exact: true }).waitFor();
    expect(await list.count()).toBe(0);
    expect(await detail.count()).toBe(0);
    expect(await page.getByText("Private billing detail", { exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 15_000);
