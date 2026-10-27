import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

// All navigation/API responses are in-memory fixtures; no app server or database is used.
test.use({ serviceWorkers: "block" });
const origin = "http://127.0.0.1:4173";
const trackingToken = "local-pickup-dialog-regression";
let bundle: string;

type OrderStatus = "PREPARING" | "READY" | "CANCELLED" | "COMPLETED" | "EXPIRED";
type FulfillmentType = "TAKEOUT" | "DINE_IN" | "DELIVERY";

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import { createRoot } from "react-dom/client";
        import { LocaleProvider } from "./src/components/locale-provider";
        import { PublicOrderTracker } from "./src/components/public-order-tracker";
        createRoot(document.getElementById("root")).render(
          <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
            <PublicOrderTracker trackingToken="${trackingToken}" />
          </LocaleProvider>
        );`,
    },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL": '""',
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '""',
    },
    plugins: [{ name: "next-link-boundary", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        loader: "tsx", resolveDir: process.cwd(),
        contents: 'export default function Link(props) { return <a {...props} />; }',
      }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

async function setup(page: Page, initialStatus: OrderStatus = "READY", initialType: FulfillmentType = "TAKEOUT") {
  let orderStatus = initialStatus;
  let fulfillmentType = initialType;
  let revision = 0;
  const errors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:00Z"));
  await page.addInitScript(() => {
    // Observe the Web Audio hardware boundary, keeping the real alert-sound code.
    const qa = window as unknown as { pickupToneStarts: number; AudioContext: unknown };
    qa.pickupToneStarts = 0;
    qa.AudioContext = class {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          frequency: { setValueAtTime() {} }, connect() {}, stop() {},
          start() { qa.pickupToneStarts += 1; },
        };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    };
  });
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (request.method() === "GET" && url.pathname === "/") {
        await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="zh-TW"><body><div id="root"></div><script src="/app.js"></script></body></html>' });
        return;
      }
      if (request.method() === "GET" && url.pathname === "/app.js") {
        await route.fulfill({ contentType: "application/javascript", body: bundle });
        return;
      }
      if (request.method() === "GET" && url.pathname === "/api/availability/config") {
        await route.fulfill({ json: { orderIntake: "EDGE_PRIMARY" } });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/public-order/get-public-order") {
        expect(request.postDataJSON().trackingToken).toBe(trackingToken);
        await route.fulfill({ json: { order: {
          orderNo: "LOCAL-001", orderStatus, fulfillmentType, pickupVerificationCode: "001",
          stallName: `Tracker fixture ${revision}`, paymentStatus: "UNPAID", totalAmount: 35, currency: "TWD",
          createdAt: "2026-01-01T00:00:00Z", confirmedAt: null, completedAt: null,
          publicMenuIdentifier: null, tableLabel: "A1", customerPhone: null, deliveryAddress: "Local fixture",
          estimatedWaitMinutes: 0, quotedWaitMinutes: null, quotedReadyAt: null, lastTableOrderAt: null,
          items: [{ id: "local-item", name: "冬瓜茶", quantity: 1, note: null, noteOptions: [], status: "READY" }],
        } } });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/public-order/manage-line-link"
        && request.postDataJSON().action === "STATUS") {
        await route.fulfill({ json: { available: false, linked: false } });
        return;
      }
    }
    unexpectedRequests.push(`${request.method()} ${request.url()}`);
    await route.abort("blockedbyclient");
  });
  await page.goto(origin);
  expect(errors).toEqual([]);
  await expect(page.getByTestId("public-order-tracker-stall-name")).toHaveText("Tracker fixture 0");
  return {
    async poll(status = orderStatus, type = fulfillmentType) {
      orderStatus = status;
      fulfillmentType = type;
      revision += 1;
      await page.clock.fastForward(3_000);
      // Wait for this response to reach the actual React render, even for repeated statuses.
      await expect(page.getByTestId("public-order-tracker-stall-name")).toHaveText(`Tracker fixture ${revision}`);
    },
    assertClean() {
      expect(errors).toEqual([]);
      expect(unexpectedRequests).toEqual([]);
    },
  };
}

const readyDialog = (page: Page) => page.getByRole("dialog", { name: "餐點已可取餐" });
const toneStarts = (page: Page) => page.evaluate(() => (window as unknown as { pickupToneStarts: number }).pickupToneStarts);

const terminalMessages = {
  CANCELLED: "訂單已取消，流程已停止。",
  COMPLETED: "訂單已完成。",
  EXPIRED: "訂單因逾時未確認，流程已結束。",
} as const;

for (const status of ["CANCELLED", "COMPLETED", "EXPIRED"] as const) {
  test(`READY to ${status} automatically closes the pickup dialog without another alert`, async ({ page }) => {
    const fixture = await setup(page);
    await expect(readyDialog(page)).toBeVisible();
    await expect(page.getByTestId("pickup-ready-dialog-code")).toHaveText("001");
    await expect.poll(() => toneStarts(page)).toBe(6); // One URGENT alert: two tones, three repetitions.
    await fixture.poll(status);
    await expect(page.getByRole("region", { name: "訂單進度" })).toContainText(terminalMessages[status]);
    await expect(page.getByTestId("pickup-code")).toHaveText("001"); // The code remains in terminal responses.
    await expect(readyDialog(page)).toHaveCount(0);
    await fixture.poll();
    await fixture.poll();
    await expect(readyDialog(page)).toHaveCount(0);
    // A later same-order READY snapshot must not resurrect the cleared flag or repeat the alert.
    await fixture.poll("READY");
    await expect(readyDialog(page)).toHaveCount(0);
    expect(await toneStarts(page)).toBe(6);
    fixture.assertClean();
  });

  test(`initial ${status} never opens the pickup dialog or plays a ready alert`, async ({ page }) => {
    const fixture = await setup(page, status);
    await expect(page.getByRole("region", { name: "訂單進度" })).toContainText(terminalMessages[status]);
    await fixture.poll();
    await expect(readyDialog(page)).toHaveCount(0);
    expect(await toneStarts(page)).toBe(0);
    fixture.assertClean();
  });
}

for (const dismissButton of ["close icon", "acknowledgement"] as const) {
  test(`repeated READY opens and sounds once, then stays dismissed via ${dismissButton}`, async ({ page }) => {
    const fixture = await setup(page, "PREPARING");
    await expect(readyDialog(page)).toHaveCount(0);
    expect(await toneStarts(page)).toBe(0);
    await fixture.poll("READY");
    await expect(readyDialog(page)).toBeVisible();
    await expect.poll(() => toneStarts(page)).toBe(6);
    await fixture.poll();
    await expect(readyDialog(page)).toHaveCount(1);
    expect(await toneStarts(page)).toBe(6);
    await readyDialog(page).getByRole("button", { name: "我知道了", exact: true })
      .nth(dismissButton === "close icon" ? 0 : 1).click();
    await expect(readyDialog(page)).toHaveCount(0);
    await fixture.poll();
    await fixture.poll();
    await expect(readyDialog(page)).toHaveCount(0);
    expect(await toneStarts(page)).toBe(6);
    fixture.assertClean();
  });
}

for (const fulfillmentType of ["DINE_IN", "DELIVERY"] as const) {
  test(`${fulfillmentType} READY does not show a takeout dialog or alert`, async ({ page }) => {
    const fixture = await setup(page, "READY", fulfillmentType);
    await fixture.poll();
    await expect(readyDialog(page)).toHaveCount(0);
    expect(await toneStarts(page)).toBe(0);
    fixture.assertClean();
  });

  test(`leaving TAKEOUT for ${fulfillmentType} clears the ready dialog without resetting deduplication`, async ({ page }) => {
    const fixture = await setup(page);
    await expect(readyDialog(page)).toBeVisible();
    await fixture.poll("READY", fulfillmentType);
    await expect(readyDialog(page)).toHaveCount(0);
    await fixture.poll("READY", "TAKEOUT");
    await expect(readyDialog(page)).toHaveCount(0);
    expect(await toneStarts(page)).toBe(6);
    fixture.assertClean();
  });
}
