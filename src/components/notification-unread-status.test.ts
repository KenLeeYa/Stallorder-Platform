import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "@playwright/test";
import path from "node:path";

let browser: Browser;
let javascript: string;
beforeAll(async () => {
  const result = await build({ stdin: { contents: `
    import { createRoot } from 'react-dom/client';
    import { NotificationUnreadStatus } from './src/components/notification-inbox';
    window.count=0; window.status=200; window.requests=[];
    window.fetch=async url=>{window.requests.push(url);return Response.json({version:'v1',unreadCount:window.count,from:'2026-10-01T00:00:00.000Z',to:'2026-10-02T00:00:00.000Z'},{status:window.status});};
    const root=createRoot(document.getElementById('root'));
    window.mount=(identity,organizationId)=>root.render(<NotificationUnreadStatus identity={identity} scope={{kind:'ORGANIZATION',organizationId}}/>);
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
