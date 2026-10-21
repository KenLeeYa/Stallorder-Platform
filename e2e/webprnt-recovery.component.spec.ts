import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";

let server: Server;
let origin: string;
const printer = { id: "44444444-4444-4444-8444-444444444444", name: "QA MCP31LB", isEnabled: true, autoDetectEnabled: true,
  connectionType: "WEBPRNT_BLUETOOTH", model: "MCP31LB", paperWidthMm: 58, isOnline: true, lastSeenAt: null,
  openCashDrawerOnCashPayment: false, cloudPrntServerUrl: null };
const state = { printModuleEnabled: true, printers: [printer], rules: [], jobs: [], catalog: [] };

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import { createRoot } from "react-dom/client";
      import { MessageTestProvider } from "./src/test/message-test-provider";
      import { PrintQueueBoard } from "./src/components/print-queue-board";
      import { StaffAutoPrintAgent } from "./src/components/staff-auto-print-agent";
      const agent = location.pathname === '/agent';
      const state = ${JSON.stringify(state)};
      if (location.search === '?manual') state.printers[0].autoDetectEnabled = false;
      createRoot(document.getElementById('root')).render(<MessageTestProvider initialLocale="zh-TW">
        {agent ? <StaffAutoPrintAgent stallSlug="qa" /> : <PrintQueueBoard stall={{slug:'qa',name:'QA',currency:'TWD'}} initialState={state} />}
      </MessageTestProvider>);` },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "framework-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(next\/script|server-only)$/ }, args => ({ path: args.path, namespace: "qa" }));
      builder.onLoad({ filter: /.*/, namespace: "qa" }, args => ({ loader: "js", contents: args.path === "server-only" ? "" :
        `import {useEffect} from 'react'; export default function Script(p){useEffect(()=>{p.onReady?.()},[]);return null}`,
      resolveDir: process.cwd() }));
    } }],
  });
  const sdk = readFileSync("public/vendor/star-webprnt/StarWebPrintTrader-1.2.0.js");
  server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url?.endsWith(".js") ? "application/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/sdk.js" ? sdk : request.url === "/app.js" ? bundle.outputFiles[0].contents :
      '<!doctype html><html><body><div id="root"></div><script src="/sdk.js"></script><script src="/app.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LOCAL_HARNESS_ADDRESS_INVALID");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function setup(page: Page, initialMode = "READY", path = "/board") {
  const commands: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(mode => {
    const qa = window as unknown as { qaMode: string; qaNativeSends: string[]; webkit: object; _onFinish: (response: object) => void };
    qa.qaMode = sessionStorage.getItem("qaMode") ?? mode;
    qa.qaNativeSends = [];
    qa.webkit = { messageHandlers: { sendMessageHandler: { postMessage: (raw: string) => {
      qa.qaNativeSends.push(raw);
      if (qa.qaMode === "SILENT") return;
      const message = JSON.parse(raw);
      const code = qa.qaMode === "BUSY" ? "2001" : qa.qaMode === "READY" ? "0" : "1100";
      const status = qa.qaMode === "PAPER_END" ? "0000000000080000" : qa.qaMode === "COVER_OPEN" ? "0000200000000000" : qa.qaMode === "OFFLINE" ? "0000080000000000" : "0000000000000000";
      queueMicrotask(() => qa._onFinish({ url: message.url, htmlCode: 200,
        response: `&lt;success&gt;${qa.qaMode === "READY"}&lt;/success&gt;&lt;code&gt;${code}&lt;/code&gt;&lt;status&gt;${status}&lt;/status&gt;` }));
    } } } };
  }, initialMode);
  await page.route("**/api/stalls/qa/print-jobs", async route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (!["REFRESH", "HEARTBEAT", "WEBPRNT_DIAGNOSTIC", "TEST_PRINTER"].includes(command.operation)) throw new Error("UNEXPECTED_QA_COMMAND");
    const current = path.endsWith("?manual") ? { ...state, printers: [{ ...printer, autoDetectEnabled: false }] } : state;
    await route.fulfill({ json: { state: current, ...(command.operation === "TEST_PRINTER" ? { printPayload: { content: "QA", dataBase64: "G0BA" } } : {}) } });
  });
  await page.goto(origin + path);
  return { commands, errors };
}
async function resume(page: Page, mode: string) {
  await page.evaluate(mode => {
    (window as unknown as { qaMode: string }).qaMode = mode;
    sessionStorage.setItem("qaMode", mode);
    window.dispatchEvent(new Event("pageshow"));
  }, mode);
}

for (const mode of ["auto", "manual"]) test(`print center ${mode} stops heartbeat after a failed overnight resume and recovers on a successful probe`, async ({ page }) => {
  const { commands, errors } = await setup(page, "READY", mode === "manual" ? "/board?manual" : "/board");
  if (mode === "manual") await page.getByRole("button", { name: "測試列印", exact: true }).click();
  await expect.poll(() => commands.filter(command => command.operation === "HEARTBEAT").length).toBeGreaterThan(0);
  await expect(page.getByTestId("webprnt-connection-status")).toHaveClass(/bg-emerald-50/);
  if (mode === "manual") await page.getByRole("dialog").getByRole("button", { name: "我知道了" }).click();
  const before = commands.filter(command => command.operation === "HEARTBEAT").length;
  await resume(page, "PAPER_END");
  await expect(page.getByTestId("webprnt-connection-status")).toContainText("缺紙");
  await expect.poll(() => commands.some(command => command.operation === "WEBPRNT_DIAGNOSTIC" && command.code === "PAPER_END")).toBe(true);
  await page.clock.fastForward(31_000);
  expect(commands.filter(command => command.operation === "HEARTBEAT")).toHaveLength(before);
  await expect(page.getByTestId("webprnt-connection-status")).not.toHaveClass(/bg-emerald-50/);
  await resume(page, "READY");
  if (mode === "manual") await page.getByRole("button", { name: "測試列印", exact: true }).click();
  await page.clock.runFor(100);
  await expect.poll(() => commands.filter(command => command.operation === "HEARTBEAT").length).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test("test-print rejection is recorded with the actual Star code, not reported as success", async ({ page }) => {
  const { commands, errors } = await setup(page, "BUSY");
  await expect(page.getByTestId("webprnt-connection-status")).toContainText("其他裝置");
  await page.getByRole("button", { name: "測試列印", exact: true }).click();
  await expect.poll(() => commands.some(command => command.phase === "TEST" && command.traderCode === "2001")).toBe(true);
  expect(commands.some(command => command.operation === "HEARTBEAT")).toBe(false);
  expect(errors).toEqual([]);
});

test("staff native callback loss times out without heartbeat, queued native sends, or automatic reprint", async ({ page }) => {
  const { commands, errors } = await setup(page, "SILENT", "/agent");
  await expect(page.getByTestId("staff-printer-status")).toBeAttached();
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaNativeSends: string[] }).qaNativeSends.length)).toBe(1);
  await expect(page.getByTestId("staff-printer-status")).toContainText("逾時", { timeout: 8_000 });
  await resume(page, "READY");
  await expect(page.getByTestId("staff-printer-status")).toContainText("停止後續送印");
  expect(commands.some(command => command.operation === "HEARTBEAT")).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { qaNativeSends: string[] }).qaNativeSends.length)).toBe(1);
  await page.reload();
  await expect.poll(() => commands.some(command => command.operation === "HEARTBEAT")).toBe(true);
  await expect(page.getByTestId("staff-printer-status")).toContainText("尚未建立並啟用自動出單規則");
  // A fresh page can probe again; the timed-out operation is never replayed.
  expect(commands.every(command => !["CLAIM", "RETRY", "SUCCESS"].includes(String(command.operation)))).toBe(true);
  expect(errors).toEqual([]);
});
