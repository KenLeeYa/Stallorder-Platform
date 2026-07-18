import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium, request as playwrightRequest } from "@playwright/test";

const baseUrlValue = process.env.PERFORMANCE_BASE_URL;
if (!baseUrlValue) {
  throw new Error("缺少 PERFORMANCE_BASE_URL，例如 https://example.vercel.app");
}

const baseUrl = new URL(baseUrlValue);
if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  throw new Error("PERFORMANCE_BASE_URL 必須使用 http 或 https。");
}
baseUrl.pathname = "/";
baseUrl.search = "";
baseUrl.hash = "";

const runs = readPositiveInteger("PERFORMANCE_RUNS", 6);
const timeoutMs = readPositiveInteger("PERFORMANCE_TIMEOUT_MS", 30_000);
const jsonOutputPath = resolve(process.env.PERFORMANCE_JSON_OUTPUT ?? "performance-results.json");
const markdownOutputPath = resolve(process.env.PERFORMANCE_MARKDOWN_OUTPUT ?? "docs/PERFORMANCE_BASELINE.md");
const qrToken = process.env.PERFORMANCE_QR_TOKEN?.trim();
const staffPath = normalizeOptionalPath(process.env.PERFORMANCE_STAFF_PATH);
const loginEmail = process.env.PERFORMANCE_LOGIN_EMAIL?.trim();
const loginPassword = process.env.PERFORMANCE_LOGIN_PASSWORD;
const vercelBypassSecret = process.env.PERFORMANCE_VERCEL_BYPASS_SECRET?.trim();
const vercelShareUrl = parseOptionalSameOriginUrl(
  process.env.PERFORMANCE_VERCEL_SHARE_URL,
  baseUrl.origin,
);

if (Boolean(loginEmail) !== Boolean(loginPassword)) {
  throw new Error("PERFORMANCE_LOGIN_EMAIL 與 PERFORMANCE_LOGIN_PASSWORD 必須同時提供或同時省略。");
}

const routes = [
  { label: "/", path: "/", budget: { ttfbP75Ms: 300 } },
  { label: "/login", path: "/login", budget: { ttfbP75Ms: 500 } },
  { label: "/onboarding", path: "/onboarding" },
  { label: "/api/health", path: "/api/health", budget: { totalP75Ms: 300 } },
  {
    label: "/q/:qrToken",
    path: qrToken ? `/q/${encodeURIComponent(qrToken)}` : null,
    skipReason: qrToken ? null : "未提供 PERFORMANCE_QR_TOKEN",
    budget: { browserLcpP75Ms: 2_500 },
  },
  { label: "/staff/orders", path: "/staff/orders", budget: { totalP75Ms: 1_000 } },
  ...(staffPath
    ? [{ label: "/staff/:stallSlug（實際路由）", path: staffPath, budget: { totalP75Ms: 1_000 } }]
    : []),
  { label: "/merchant/dashboard", path: "/merchant/dashboard", budget: { totalP75Ms: 1_500 } },
];

const timingMetricMap = {
  total: "totalMs",
  auth: "authMs",
  db: "dbMs",
  "db-connect": "dbConnectMs",
  "edge-function": "edgeFunctionMs",
  turnstile: "turnstileMs",
  render: "renderMs",
  "external-api": "externalApiMs",
};

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  targetOrigin: baseUrl.origin,
  requestRuns: runs,
  authentication: loginEmail ? "provided" : "not_provided",
  deploymentProtectionBypass: vercelBypassSecret ? "provided" : "not_provided",
  deploymentProtectionShare: vercelShareUrl ? "provided" : "not_provided",
  privacy: {
    responseBodiesStored: false,
    credentialsStored: false,
    cookiesStored: false,
    rawQrTokensStored: false,
  },
  methodology: {
    coldLike: "每條路由的第一個要求帶 Cache-Control: no-cache；不保證觸發真正的 Serverless cold start。",
    warm: "同一程序內重複要求，統計最小值、中位數、P75、P95 與最大值。",
    mobileNetwork: "合成 Android 行動網路：80ms RTT、4 Mbps 下載、1.5 Mbps 上傳。",
    browserTrace: "Playwright Navigation/Resource Timing；未保存頁面內容。",
  },
  routes: [],
  warnings: [],
};

let authenticationState;
if ((loginEmail && loginPassword) || vercelShareUrl) {
  authenticationState = await establishAccessState(
    baseUrl.origin,
    loginEmail,
    loginPassword,
    vercelBypassSecret,
    vercelShareUrl,
  );
}

for (const route of routes) {
  if (!route.path) {
    result.routes.push({
      route: route.label,
      status: "skipped",
      reason: route.skipReason,
    });
    continue;
  }

  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    samples.push(await measureHttpRequest({
      url: new URL(route.path, baseUrl.origin),
      coldLike: index === 0,
      timeoutMs,
      cookieHeader: cookieHeaderForUrl(authenticationState?.cookies ?? [], baseUrl.origin),
      vercelBypassSecret,
    }));
  }

  const browser = await measureBrowserRoute({
    origin: baseUrl.origin,
    routePath: route.path,
    timeoutMs,
    storageState: authenticationState,
    vercelBypassSecret,
  });

  const routeResult = {
    route: route.label,
    status: "measured",
    httpStatus: samples[0]?.status ?? null,
    redirectLocationPresent: samples.some((sample) => sample.redirectLocationPresent),
    coldLike: samples[0],
    warm: summarizeSamples(samples.slice(1)),
    browser,
    budget: route.budget ?? null,
    budgetWarnings: [],
  };

  routeResult.budgetWarnings = evaluateBudgets(routeResult);
  result.warnings.push(...routeResult.budgetWarnings.map((warning) => `${route.label}: ${warning}`));
  result.routes.push(routeResult);
}

await mkdir(dirname(jsonOutputPath), { recursive: true });
await mkdir(dirname(markdownOutputPath), { recursive: true });
await writeFile(jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(markdownOutputPath, renderMarkdown(result), "utf8");

console.log(JSON.stringify({
  event: "performance_measurement_completed",
  targetOrigin: result.targetOrigin,
  measuredRoutes: result.routes.filter((route) => route.status === "measured").length,
  warningCount: result.warnings.length,
  jsonOutputPath,
  markdownOutputPath,
}));

async function establishAccessState(origin, email, password, bypassSecret, shareUrl) {
  const context = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      origin,
      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
    },
  });

  try {
    if (shareUrl) {
      const shareResponse = await context.get(shareUrl.toString(), { timeout: timeoutMs });
      if (!shareResponse.ok()) {
        throw new Error(`無法建立 Preview 存取狀態（HTTP ${shareResponse.status()}）。`);
      }
    }
    if (email && password) {
      const response = await context.post("/api/auth/login", {
        data: { email, password },
        timeout: timeoutMs,
      });
      if (!response.ok()) {
        throw new Error(`效能量測登入失敗（HTTP ${response.status()}）。`);
      }
    }
    return context.storageState();
  } finally {
    await context.dispose();
  }
}

function parseOptionalSameOriginUrl(value, expectedOrigin) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("PERFORMANCE_VERCEL_SHARE_URL 必須是有效的 HTTPS URL。");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== expectedOrigin) {
    throw new Error("PERFORMANCE_VERCEL_SHARE_URL 必須與 PERFORMANCE_BASE_URL 使用相同來源。");
  }
  if (!parsed.searchParams.has("_vercel_share")) {
    throw new Error("PERFORMANCE_VERCEL_SHARE_URL 缺少短效分享參數。");
  }
  return parsed;
}

async function measureHttpRequest({
  url,
  coldLike,
  timeoutMs: requestTimeoutMs,
  cookieHeader,
  vercelBypassSecret: bypassSecret,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers = {
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    "user-agent": "StallOrder-Performance-Smoke/1.0",
  };
  if (coldLike) headers["cache-control"] = "no-cache";
  if (cookieHeader) headers.cookie = cookieHeader;
  if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;

  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    const headersAt = performance.now();
    const body = await response.arrayBuffer();
    const completedAt = performance.now();

    return {
      kind: coldLike ? "cold_like" : "warm",
      status: response.status,
      ttfbMs: round(headersAt - startedAt),
      totalMs: round(completedAt - startedAt),
      responseBytes: body.byteLength,
      htmlBytes: response.headers.get("content-type")?.includes("text/html") ? body.byteLength : 0,
      redirectLocationPresent: response.headers.has("location"),
      serverTiming: parseServerTiming(response.headers.get("server-timing")),
      vercelCache: response.headers.get("x-vercel-cache") ?? null,
      vercelEdgePop: parseVercelEdgePop(response.headers.get("x-vercel-id")),
    };
  } catch (error) {
    return {
      kind: coldLike ? "cold_like" : "warm",
      error: error instanceof Error ? error.name : "RequestError",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function measureBrowserRoute({
  origin,
  routePath,
  timeoutMs: navigationTimeoutMs,
  storageState,
  vercelBypassSecret: bypassSecret,
}) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return {
      status: "skipped",
      reason: `Chromium 無法啟動：${error instanceof Error ? error.name : "LaunchError"}`,
    };
  }

  try {
    const profiles = [
      {
        name: "desktop",
        contextOptions: {
          viewport: { width: 1440, height: 900 },
          storageState,
          extraHTTPHeaders: bypassSecret
            ? { "x-vercel-protection-bypass": bypassSecret }
            : undefined,
        },
      },
      {
        name: "android_mobile_synthetic_tw",
        contextOptions: {
          viewport: { width: 393, height: 852 },
          deviceScaleFactor: 2.75,
          isMobile: true,
          hasTouch: true,
          userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
          storageState,
          extraHTTPHeaders: bypassSecret
            ? { "x-vercel-protection-bypass": bypassSecret }
            : undefined,
        },
        network: {
          latency: 80,
          downloadThroughput: 4 * 1024 * 1024 / 8,
          uploadThroughput: 1.5 * 1024 * 1024 / 8,
        },
      },
    ];

    const measurements = {};
    for (const profile of profiles) {
      measurements[profile.name] = await measureBrowserProfile({
        browser,
        origin,
        routePath,
        navigationTimeoutMs,
        ...profile,
      });
    }
    return { status: "measured", profiles: measurements };
  } finally {
    await browser.close();
  }
}

async function measureBrowserProfile({ browser, origin, routePath, contextOptions, network, navigationTimeoutMs }) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__stallorderLcp = 0;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries.at(-1);
      if (last) window.__stallorderLcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });

  try {
    if (network) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        connectionType: "cellular4g",
        ...network,
      });
    }

    const orderSessionResponse = routePath.startsWith("/q/") || routePath.startsWith("/delivery/")
      ? page.waitForResponse(
          (candidate) => candidate.url().includes("/create-order-session"),
          { timeout: navigationTimeoutMs },
        ).catch(() => null)
      : null;
    const response = await page.goto(new URL(routePath, origin).href, {
      waitUntil: "load",
      timeout: navigationTimeoutMs,
    });
    if (orderSessionResponse) await orderSessionResponse;
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const sum = (entries, field) => entries.reduce((total, entry) => total + (entry[field] || 0), 0);
      const scripts = resources.filter((entry) => entry.initiatorType === "script" || /\.(?:js|mjs)(?:\?|$)/.test(entry.name));
      const images = resources.filter((entry) => entry.initiatorType === "img" || /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i.test(entry.name));
      const knownExternalRequests = resources.flatMap((entry) => {
        let route = null;
        try {
          const path = new URL(entry.name).pathname;
          if (path.endsWith("/create-order-session")) route = "create-order-session";
          else if (path.endsWith("/create-public-order")) route = "create-public-order";
          else if (path.endsWith("/get-public-order")) route = "get-public-order";
          else if (entry.name.includes("challenges.cloudflare.com/turnstile")) route = "turnstile-resource";
        } catch {
          route = null;
        }
        return route ? [{ route, durationMs: entry.duration }] : [];
      });

      return {
        ttfbMs: navigation ? navigation.responseStart - navigation.requestStart : null,
        totalMs: navigation ? navigation.loadEventEnd - navigation.startTime : null,
        fcpMs: fcp?.startTime ?? null,
        lcpMs: window.__stallorderLcp || null,
        htmlTransferBytes: navigation?.transferSize ?? null,
        javascriptTransferBytes: sum(scripts, "transferSize"),
        javascriptDecodedBytes: sum(scripts, "decodedBodySize"),
        imageTransferBytes: sum(images, "transferSize"),
        resourceCount: resources.length,
        scriptCount: scripts.length,
        imageCount: images.length,
        externalRequests: knownExternalRequests,
      };
    });

    return {
      status: response?.status() ?? null,
      ...Object.fromEntries(Object.entries(metrics).map(([key, value]) => [
        key,
        typeof value === "number"
          ? round(value)
          : key === "externalRequests" && Array.isArray(value)
            ? value.map((entry) => ({ ...entry, durationMs: round(entry.durationMs) }))
            : value,
      ])),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.name : "NavigationError" };
  } finally {
    await context.close();
  }
}

function parseServerTiming(header) {
  if (!header) return null;
  const parsed = {};
  for (const entry of header.split(",")) {
    const [rawName, ...parameters] = entry.trim().split(";");
    const key = timingMetricMap[rawName];
    if (!key) continue;
    const duration = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith("dur="));
    if (!duration) continue;
    const value = Number(duration.slice(4));
    if (Number.isFinite(value) && value >= 0) parsed[key] = round(value);
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function parseVercelEdgePop(vercelId) {
  if (!vercelId) return null;
  const candidate = vercelId.split("::")[0]?.trim();
  return /^[a-z]{3}\d$/.test(candidate) ? candidate : null;
}

function summarizeSamples(samples) {
  const successful = samples.filter((sample) => !sample.error);
  return {
    sampleCount: successful.length,
    statusCodes: [...new Set(successful.map((sample) => sample.status))],
    ttfbMs: summarizeNumbers(successful.map((sample) => sample.ttfbMs)),
    totalMs: summarizeNumbers(successful.map((sample) => sample.totalMs)),
    responseBytes: summarizeNumbers(successful.map((sample) => sample.responseBytes)),
    serverTiming: summarizeServerTiming(successful),
    vercelEdgePops: [...new Set(successful.map((sample) => sample.vercelEdgePop).filter(Boolean))],
    errors: samples.length - successful.length,
  };
}

function summarizeServerTiming(samples) {
  const resultByMetric = {};
  for (const metric of Object.values(timingMetricMap)) {
    const values = samples.map((sample) => sample.serverTiming?.[metric]).filter(Number.isFinite);
    if (values.length > 0) resultByMetric[metric] = summarizeNumbers(values);
  }
  return Object.keys(resultByMetric).length > 0 ? resultByMetric : null;
}

function summarizeNumbers(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  return {
    min: round(finite[0]),
    median: round(percentile(finite, 0.5)),
    p75: round(percentile(finite, 0.75)),
    p95: round(percentile(finite, 0.95)),
    max: round(finite.at(-1)),
  };
}

function percentile(sorted, percentileValue) {
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function evaluateBudgets(routeResult) {
  const warnings = [];
  const budget = routeResult.budget;
  if (!budget) return warnings;
  const warmTtfb = routeResult.warm?.ttfbMs?.p75;
  const warmTotal = routeResult.warm?.totalMs?.p75;
  const mobileLcp = routeResult.browser?.profiles?.android_mobile_synthetic_tw?.lcpMs;
  if (budget.ttfbP75Ms && Number.isFinite(warmTtfb) && warmTtfb > budget.ttfbP75Ms) {
    warnings.push(`暖要求 TTFB P75 ${warmTtfb}ms 超過 ${budget.ttfbP75Ms}ms 預算`);
  }
  if (budget.totalP75Ms && Number.isFinite(warmTotal) && warmTotal > budget.totalP75Ms) {
    warnings.push(`暖要求總時間 P75 ${warmTotal}ms 超過 ${budget.totalP75Ms}ms 預算`);
  }
  if (budget.browserLcpP75Ms && Number.isFinite(mobileLcp) && mobileLcp > budget.browserLcpP75Ms) {
    warnings.push(`合成 Android LCP ${mobileLcp}ms 超過 ${budget.browserLcpP75Ms}ms 預算`);
  }
  return warnings;
}

function renderMarkdown(measurement) {
  const lines = [
    "# StallOrder 效能基準",
    "",
    `- 量測時間：${measurement.generatedAt}`,
    `- 目標來源：${measurement.targetOrigin}`,
    `- 每條路由要求數：${measurement.requestRuns}（第一筆為 cold-like，其餘為 warm）`,
    `- 驗證狀態：${measurement.authentication === "provided" ? "使用環境變數提供的測試帳號" : "未登入"}`,
    "- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。",
    "",
    "> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。",
    "",
    "## HTTP 結果",
    "",
    "| 路由 | 狀態 | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | HTML/回應大小 | Vercel Edge PoP |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const route of measurement.routes) {
    if (route.status !== "measured") {
      lines.push(`| ${route.route} | 略過：${route.reason} | - | - | - | - | - | - |`);
      continue;
    }
    lines.push([
      `| ${route.route}`,
      route.httpStatus ?? "-",
      formatMs(route.coldLike?.ttfbMs),
      formatMs(route.coldLike?.totalMs),
      formatMs(route.warm?.ttfbMs?.p75),
      formatMs(route.warm?.totalMs?.p75),
      formatBytes(route.warm?.responseBytes?.median),
      route.warm?.vercelEdgePops?.join(", ") || route.coldLike?.vercelEdgePop || "-",
    ].join(" | ") + " |");
  }

  lines.push(
    "",
    "## 瀏覽器結果",
    "",
    "| 路由 | 裝置 | TTFB | FCP | LCP | JS 傳輸 | 圖片傳輸 | Order Session |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const route of measurement.routes) {
    if (route.status !== "measured" || route.browser?.status !== "measured") continue;
    for (const [profileName, profile] of Object.entries(route.browser.profiles)) {
      const orderSession = profile.externalRequests?.find((request) => request.route === "create-order-session");
      lines.push(`| ${route.route} | ${profileName} | ${formatMs(profile.ttfbMs)} | ${formatMs(profile.fcpMs)} | ${formatMs(profile.lcpMs)} | ${formatBytes(profile.javascriptTransferBytes)} | ${formatBytes(profile.imageTransferBytes)} | ${formatMs(orderSession?.durationMs)} |`);
    }
  }

  lines.push("", "## 預算警告", "");
  if (measurement.warnings.length === 0) {
    lines.push("目前量測項目沒有觸發預算警告；未量測項目不視為通過。");
  } else {
    for (const warning of measurement.warnings) lines.push(`- ${warning}`);
  }

  lines.push(
    "",
    "## 限制",
    "",
    "- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。",
    "- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。",
    "- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。",
    "- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。",
    "- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function cookieHeaderForUrl(cookies, origin) {
  const host = new URL(origin).hostname;
  return cookies
    .filter((cookie) => host === cookie.domain.replace(/^\./, "") || host.endsWith(cookie.domain.replace(/^\./, "")))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function normalizeOptionalPath(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    throw new Error("PERFORMANCE_STAFF_PATH 必須是以單一 / 開頭的站內路徑。");
  }
  return trimmed;
}

function readPositiveInteger(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 2) {
    throw new Error(`${name} 必須是至少 2 的整數。`);
  }
  return parsed;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value} ms` : "-";
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "-";
  if (value < 1024) return `${value} B`;
  return `${round(value / 1024)} KB`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
