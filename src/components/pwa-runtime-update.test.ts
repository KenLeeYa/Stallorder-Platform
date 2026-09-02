import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("PWA 安全無縫更新契約", () => {
  it("以新版 service worker 觸發更新且先檢查未同步資料", () => {
    const worker = readFileSync(join(projectRoot, "public", "sw.js"), "utf8");

    expect(worker).toContain('const CACHE_NAME = "stallorder-shell-v9";');
    expect(worker).toContain('event.data?.type === "CHECK_UPDATE_SAFETY"');
    expect(worker).toContain('event.data?.type === "ACTIVATE_UPDATE"');
    expect(worker).toContain("if (pendingRecords > 0)");
  });

  it("只在前景、連線、閒置且沒有未儲存表單時自動套用", () => {
    const runtime = readFileSync(
      join(projectRoot, "src", "components", "pwa-update-controller.tsx"),
      "utf8",
    );

    expect(runtime).toContain("SERVICE_WORKER_UPDATE_INTERVAL_MS = 5 * 60_000");
    expect(runtime).toContain("SAFE_AUTO_UPDATE_IDLE_MS = 30_000");
    expect(runtime).toContain('document.visibilityState !== "visible"');
    expect(runtime).toContain("!navigator.onLine");
    expect(runtime).toContain("hasUnsavedFormChanges()");
    expect(runtime).toContain('worker.postMessage({ type: "CHECK_UPDATE_SAFETY" })');
    expect(runtime).toContain("/api/version?current=");
    expect(runtime).toContain("payload.revision === CLIENT_BUILD_REVISION");
    expect(runtime).toContain("waitingWorkerRef.current || deploymentUpdateAvailableRef.current");
    expect(runtime).toContain("activeMutationsRef.current > 0");
    expect(runtime).toContain("stillActive");
    expect(runtime).toContain("if (!registration || disposed) return");
    expect(runtime).toContain(".catch(() => undefined)");

    const shell = readFileSync(
      join(projectRoot, "src", "components", "pwa-runtime.tsx"),
      "utf8",
    );
    expect(shell).toContain('lazy(() => import("@/components/pwa-update-controller")');
  });

  it("只離線快取明確標記且不含敏感查詢的 public navigation", () => {
    const worker = readFileSync(join(projectRoot, "public", "sw.js"), "utf8");
    const nextConfig = readFileSync(join(projectRoot, "next.config.ts"), "utf8");

    expect(worker).toContain("purgeSensitiveNavigationEntries");
    expect(worker).toContain("hasSensitiveQuery");
    expect(worker).toContain("private|no-store");
    expect(worker).toContain("x-stallorder-offline-cache");
    expect(worker).toContain("OFFLINE_PUBLIC_MENU_RESPONSE");
    expect(nextConfig).toContain('source: "/q/:qrToken"');
    expect(nextConfig).toContain('source: "/store/:identifier"');
    expect(nextConfig).toContain('{ key: "X-StallOrder-Offline-Cache", value: "public-menu-v1" }');
  });

  it("禁止瀏覽器或 CDN 快取 service worker 入口", () => {
    const nextConfig = readFileSync(join(projectRoot, "next.config.ts"), "utf8");

    expect(nextConfig).toContain('source: "/sw.js"');
    expect(nextConfig).toContain('value: "no-store, max-age=0, must-revalidate"');
  });

  it("部署版本端點永遠回傳不可快取的目前版本", () => {
    const route = readFileSync(
      join(projectRoot, "src", "app", "api", "version", "route.ts"),
      "utf8",
    );

    expect(route).toContain("process.env.VERCEL_GIT_COMMIT_SHA");
    expect(route).toContain('"cache-control": "no-store, max-age=0, must-revalidate"');
  });

  it("重新進入店員或廚房頁面時恢復保持喚醒選擇", () => {
    const runtime = readFileSync(
      join(projectRoot, "src", "components", "pwa-runtime.tsx"),
      "utf8",
    );

    expect(runtime).toContain("readWakeLockPreference(window.localStorage)");
    expect(runtime).toContain("writeWakeLockPreference(window.localStorage, true)");
    expect(runtime).toContain("writeWakeLockPreference(window.localStorage, false)");
    expect(runtime).toContain("if (wakeLockRequestedRef.current) void requestWakeLock()");
  });
});
