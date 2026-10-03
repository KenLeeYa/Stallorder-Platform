import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect, test } from "@playwright/test";


test("Preview harness fixes login locale and safely settles owned pending HEAD and SSE at shutdown", async ({}, testInfo) => {
  const { createPreviewContext, shutdownPreviewBrowser, sanitizedCaseFailure } = await import("../scripts/qa-pr366-preview-ui.mjs");
  let markHeadStarted!: () => void, markStreamStarted!: () => void;
  const headStarted = new Promise<void>(resolve => { markHeadStarted = resolve; });
  const streamStarted = new Promise<void>(resolve => { markStreamStarted = resolve; });
  const requests: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/api/connectivity") {
      requests.push("HEAD"); markHeadStarted(); return;
    }
    if (request.url === "/api/stalls/aming-chicken/orders/stream") {
      requests.push("SSE"); response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: initial\n\n"); markStreamStarted(); return;
    }
    const chinese = request.headers.cookie?.includes("stallorder_locale=zh-TW")
      || request.headers["accept-language"]?.startsWith("zh-TW");
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<button onclick="document.querySelector('output').textContent='clicked'">${chinese ? "使用電子郵件與密碼登入" : "Sign in with email and password"}</button><output></output>`);
  });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LOOPBACK_PROOF_ADDRESS_INVALID");
  const origin = `http://127.0.0.1:${address.port}`;
  const unhandled: string[] = [];
  const onUnhandled = () => { unhandled.push("UNHANDLED_ROUTE_ERROR"); };
  process.on("unhandledRejection", onUnhandled);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const defaultContext = await browser.newContext();
    const defaultPage = await defaultContext.newPage(); await defaultPage.goto(origin);
    await expect(defaultPage.getByRole("button", { name: "Sign in with email and password", exact: true })).toBeVisible();
    await expect(defaultPage.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true })).toHaveCount(0);
    await defaultContext.close();
    const context = await createPreviewContext(browser, origin, "synthetic-test-header");
    const page = await context.newPage(); await page.goto(origin);
    await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await expect(page.locator("output")).toHaveText("clicked");
    const evidence = { status: "FAIL", failure: sanitizedCaseFailure({ name: "TimeoutError", message: "synthetic sensitive header" }, "STAFF_PASSWORD_LOGIN") };
    const evidencePath = testInfo.outputPath("sanitized-primary-failure.json");
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const head = page.evaluate(() => fetch("/api/connectivity", { method: "HEAD" }).then(response => response.status)).catch(() => "PAGE_CLOSED");
    await headStarted;
    await page.evaluate(() => { new EventSource("/api/stalls/aming-chicken/orders/stream"); });
    await streamStarted;
    await shutdownPreviewBrowser(browser);
    await head;
    expect(browser.isConnected()).toBe(false);
    expect(requests).toContain("HEAD");
    expect(requests).toContain("SSE");
    expect(requests.every(kind => kind === "HEAD" || kind === "SSE")).toBe(true);
    expect(unhandled).toEqual([]);
    expect(JSON.parse(readFileSync(evidencePath, "utf8"))).toEqual({ status: "FAIL", failure: { stage: "STAFF_PASSWORD_LOGIN", code: "PREVIEW_UI_TIMEOUT" } });
  } finally {
    if (browser?.isConnected()) await browser.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => resolve()); });
    expect(server.listening).toBe(false);
    process.off("unhandledRejection", onUnhandled);
  }
});
