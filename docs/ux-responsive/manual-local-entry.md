# Responsive 3026 手動 QA 入口

這是隔離本機候選，不是正式站。工作樹為 `C:/Users/KY/.codex/worktrees/responsive-cross-device/Stallorder-Platform`，分支 `codex/responsive-cross-device-20260930`；目標 app `http://127.0.0.1:3026`、Supabase API `127.0.0.1:56821`、DB `127.0.0.1:56822`。2026-10-01 03:35（台北）讀回 app 正以被測來源 `951da26`／BUILD_ID `JkhAOmjpcVnrPc59NHe-l` 運行；候選收據見[合併 QA 證據](b3-final-qa-evidence.md)。目前的測試資料是**首輪整批後、120 個已知任務精確修復**的本機資料，不是 B3.2 當時的不可變全欄位凍結快照。請勿把手測所得當作舊配對效能的新樣本。

開 `http://127.0.0.1:3026/login`，使用此隔離 lab 既有 seed 使用者登入：商家 `owner@stallorder.test` → `/merchant/dashboard`；店員 `staff@stallorder.test` → `/staff/aming-chicken`，從「店員點餐」進 POS；廚房 `kitchen@stallorder.test` → `/kitchen?stall=aming-chicken`；平台管理員 `platform.admin@stallorder.test` → `/admin/billing`。匿名顧客菜單可用 `/store/aming-01?view=menu`；`/mini` 顯示目前真實的供應商設定需求狀態，並無真 LINE 登入或付款。四個角色共用的**本機 seed 測試密碼**定義在 [prisma/seed.ts:722](../../prisma/seed.ts)；請從該受控檔案讀取，不要為取密碼重跑 seed。私有密碼、QR token 及付款憑證不寫在此文件；需要建立有效 QR 訂單時只用此 lab 內受控 QR 頁與測試資料，勿複製到其他環境。

**請為 3026 開一個獨立／私密瀏覽器 profile，並與 3023 的已開瀏覽器分開。** `src/lib/auth.ts` 的 `stallorder_session`、`stallorder_csrf` 與裝置 cookie 使用相同 host-only、`path: "/"` scope，沒有 `Domain` 分隔；瀏覽器 cookie scope 不含 TCP port。兩個 app 同為 `127.0.0.1` 時，混用同一 profile 可能互相覆寫登入／CSRF／裝置 cookie。不要為了避開這點變更 app 的認證或 CORS 契約，也不要擅換 `localhost` 主機名。

若 3026 尚未保留運行：先確認沒有其他 3026 listener／`.next` consumer、七個 `stallorder-responsive-20260930` 容器屬於本任務且健康、Functions 56821 可用，再在上述工作樹使用**精確** `.env.local` 載入程序並讀回 build provenance 後啟動 Next production server。可在 PowerShell 執行：

```powershell
Set-Location C:/Users/KY/.codex/worktrees/responsive-cross-device/Stallorder-Platform
node -e "const fs=require('fs'),u=require('util'),cp=require('child_process');Object.assign(process.env,u.parseEnv(fs.readFileSync('.env.local','utf8')));cp.spawnSync(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3026'],{env:process.env,stdio:'inherit'})"
```

此指令會前景運行，關閉該終端才停止該 app；不要與 Playwright 的 3026 webServer 或另一個 build 同時運作。`scripts/build-responsive-qa.mjs` 只在 3026 停止且來源確認後重建，不能把舊 BUILD_ID 貼到新建置。需要重啟完整 lab 時依[本機服務生命週期](../LOCAL_TEST_SERVICE_LIFECYCLE.md)核對 project labels、ports 與 owner；只操作這七個容器與本輪 Functions，不使用 reset/prune/volume 刪除。3023／55722 是另一本機 QA，維持原樣。

此 lab 的 `DUAL_ORDER_INTAKE_ENABLED` 預設為停用；2026-10-01 03:22（台北）唯讀檢查顯示**唯一 GLOBAL 有界覆寫**已啟用，但將於 **2026-10-01 08:20:50（台北）**到期。到期後不能再把雙路進單當成可用；未登入 `/api/health` 實際回 401，也不能當作公開的下單健康證據。需要繼續手測時，先用上述獨立 profile 的平台管理員登入並停在 `http://127.0.0.1:3026/admin/billing`，在該頁瀏覽器開發者工具 Console 執行以下**每次只延長六小時**的既有受稽核管理 API 操作。此操作僅限 3026／56822；不改旗標預設、不設永久有效、不排程自動續期：

```js
(async () => {
  if (location.origin !== "http://127.0.0.1:3026") throw new Error("WRONG_QA_ORIGIN");
  const cookie = document.cookie.split("; ").find((part) => part.startsWith("stallorder_csrf="));
  if (!cookie) throw new Error("PLATFORM_ADMIN_LOGIN_REQUIRED");
  const csrf = decodeURIComponent(cookie.slice("stallorder_csrf=".length));
  const expiresAt = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const url = "/api/admin/resilience/feature-flags/DUAL_ORDER_INTAKE_ENABLED";
  const changed = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ scopeType: "GLOBAL", organizationId: null, stallId: null,
      deviceId: null, enabled: true, rolloutPercentage: null, expiresAt,
      reason: "Isolated responsive 3026 manual QA, six-hour extension" }),
  });
  if (!changed.ok) throw new Error(`FLAG_UPDATE_HTTP_${changed.status}`);
  const checked = await fetch("/api/admin/resilience/feature-flags", { cache: "no-store" });
  if (!checked.ok) throw new Error(`FLAG_READBACK_HTTP_${checked.status}`);
  const flag = (await checked.json()).flags.find((item) => item.code === "DUAL_ORDER_INTAKE_ENABLED");
  const active = flag?.overrides.filter((item) => item.scopeType === "GLOBAL" && item.enabled &&
    item.expiresAt && new Date(item.expiresAt) > new Date()) ?? [];
  if (active.length !== 1 || active[0].expiresAt !== expiresAt) throw new Error("FLAG_READBACK_MISMATCH");
  console.info({ origin: location.origin, scope: "GLOBAL", enabled: true, expiresAt });
})();
```

只有 Console 顯示同源、GLOBAL、enabled 與新到期時間，且重新整理後以**此 lab 的有效 QR 真實操作**確認可下單，才算新時段的手測入口可用。若更新或讀回失敗，停止雙路訂單手測並先排查登入、權限與本機 lab；不要換用 3023、清限流桶或啟用真供應商旗標。

手測建議各角色完成一條可回查的真實操作：顧客有效選餐/取餐方式、店員查單與 POS 不重收款、廚房看板選單與完成、商家 390/768/1024/1440 圖示與設定、Admin 窄版詳情；記錄角色、瀏覽器／作業系統、實際 viewport、日期/語言/主題、測試 order ID、觀察結果與螢幕截圖。真實手機／平板轉向、虛擬鍵盤、安全區、觸控、NVDA/VoiceOver 與真 LINE／Pay/紙本印表機仍需另做並標 NOT_RUN，不能由本機桌面模擬自動轉成通過。
