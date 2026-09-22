# Phase 00：真實系統盤點

日期：2026-09-23（Asia/Taipei）。需求全文已閱讀：`C:/Users/KY/Downloads/Stallorder_UI_UX_Redesign_Codex_Master_Prompt.md`。本文件是本輪證據，不沿用舊 QA 的成功宣告。

## 版本及隔離

- 原工作樹：`Stallorder-Platform`，detached `d506ff5`，有既存 AGENTS、事故文件、Prisma 修改與未追蹤檔；全部保留。
- 實作工作樹：`Stallorder-Platform-ui-ux-redesign-20260923`；分支 `codex/ui-ux-redesign-20260923`；基準 `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`，與本次讀取的 origin/main 相同。
- 原工作樹有 CodeGraph 並已查詢；新工作樹沒有索引，使用來源搜尋，不自行建立索引。
- Vercel 實讀：Primary `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`，deployment `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`，production / READY / 上述 commit，hnd1。以 `app.qidaigo.com` 查到此 deployment。未寫入雲端。
- 正式 `/login`、`/staff/login`、`/api/connectivity` 回應 200；未登入 `/api/health` 回應 401。這只是入口／權限基準，不是交易或 DR 健康驗收。後端 writer 身分及登入後健康詳細資料尚未讀取。
- 本機 3023 使用獨立 Next 程序；只啟動 `stallorder-catalog-ops-20260907` 的既有 DB 55722（161 筆既有訂單）。沿用本機專用設定，付款 mock、寄送 simulate，未載入正式密鑰；測完停止本次啟動服務。

## 技術棧

| 面向 | 來源／實際情形 |
|---|---|
| 框架 | package.json：Next 16.3.4、React/DOM 19.2.4、TypeScript 5；npm lockfile，npm ci |
| 路由／渲染 | App Router，119 個 page/layout 檔；Server Components、Suspense 串流，互動元件 client，POS catalog 等 dynamic lazy 載入 |
| 狀態 | React state/memo/ref；工作台 controller 與 presentation 分離；沒有引入 Redux |
| 表單／安全 | 原生表單、Zod strict、CSRF/origin、伺服器角色驗證及 DB RLS；輸入 UI 不是授權邊界 |
| 資料 | Prisma 6、Supabase/Postgres；公開單 Edge/RPC 或 Circuit B；Realtime/SSE/受控輪詢 |
| 視覺 | Tailwind 4、lucide-react、clsx；既有 stone/teal 品牌，globals.css 的 light/dark/senior/focus/field tokens |
| 字型 | next/font Geist/Geist Mono，中文依系統 fallback；需補明確中文優先 fallback |
| 語系 | zh-TW/en/ja/ko/vi/th；operations、merchant、public-order 字典；既有供應設定存在中文字串債務 |
| PWA | PwaRuntime、Service Worker、離線佇列、Web Push；桌面瀏覽器的播放音效與 OS 通知音分開 |
| 測試 | Vitest、Playwright、pgTAP、lint、tsc、ui:audit、performance:bundles；不得把 skip 當 pass |
| 部署 | Vercel Primary/DR、Supabase、Cloudflare；本輪僅本機，正式部署與外部設定列人工清單 |

## 核心資料流與邊界

`/q/[qrToken]`、`/store/[stallCode]` → 公開 session / menu → QrOrderCartPanel + checkout controller → 伺服器建單、價格／可售量／session／冪等驗證 → orders → StaffOrderBoard controller/live → 接單／製作／出餐 → 付款、列印工作、顧客追蹤、通知、報表。

店員 `/staff/[stallSlug]` 在 Server Page 以 `requirePagePermission(VIEW_ORDERS)` 驗證；只查 activeOrderStatuses。商品設定、容量與價格從 server 查詢。`StaffOrderBoardPresentation` 不自行決定交易權限。

`primary-print-status.ts` 依原票、重印與修改單工作家族解析列印結果；成功原票不因後續備份票失敗被撤回。變更單仍須獨立成功。退款、現金抽屜、列印代理、支付 provider、發票及 DR 不在本輪重寫範圍。

## 狀態盤點

| 狀態 | 現有機制與要驗證的缺口 |
|---|---|
| loading | RouteLoadingSkeleton、按鈕 busy；確認首頁 cold compile 與 warm 測試分開 |
| empty | 訂單空清單／搜尋無結果已有文案；欠狀態篩選清除入口 |
| error/conflict | API 結構化錯誤、controller 保留原單、庫存版本；本輪測 409/429/500 的保留與恢復 |
| offline | PWA connectivity、OfflineQueueStatus、唯一 Leader；不將離線狀態當可任意補送 |
| unauthorized/expired | server page/API guard、session、QR 到期 dialog；role 顯示與 API 拒絕須分測 |
| partial/unknown | 批次 controller、付款狀態查詢、print job；結果未知時不得重建交易 |

## 初始問題與量測

- 店員列表同時 render 手機所有完整票與桌面列表，再 CSS 隱藏；100+ 筆時 DOM 隨全部品項增長。這是靜態來源發現，速度改善須實測。
- 工作台只有文字搜尋，缺各營運狀態數量／來源篩選，左卡未顯示付款及列印摘要。
- `ExperienceDialog` 有 native modal/focus restoration；其他元件仍各自實作 modal，需逐項驗證，不能全域替換。
- 既有 senior 規則主要在 1023px 以下，資料正文尚有大量 text-xs；桌機長者模式與高密度表單需改善。
- 商品供應已支援 TODAY/TEMPORARY/UNTIL_DATE/PERMANENT，恢復時間由商家時區／營業日決定；不可再新增競爭狀態模型。
- 本機登入初測曾因頁面首次編譯超過現有導航等待失敗；保留紀錄，先預熱再以原斷言重測。
- CUA 的 IAB attach 與 Chrome 建頁逾時，改由專案 Playwright 自動化套件取得瀏覽器證據；CUA 人工互動尚未完成。
- 後續已完成同機同資料 before/after 截圖、DOM 與 production bundle 量測，詳見 verification-report。正式 CWV field data／Lighthouse 與真人任務時間未量測，不宣稱改善。

## 分批執行

1. Phase 00–03：盤點、官方研究、風險 backlog、IA/設計規格；先固定真實 baseline。
2. Phase 04–05：工作台狀態／來源／付款／列印可讀性、有限列表與安全恢復；保留所有權威 controller。
3. Phase 06–11：點餐表單與購物車、商品供應、後台、長者模式、報表與效能；優先共用既有元件，不補不存在的 backend 能力。
4. Phase 12–15：分角色真實流程、錯誤邊界、視覺／鍵盤、全套必要檢查、回復文件。外部硬體／provider／人工螢幕閱讀器未測即保留缺口。

採用 skills：product-release-qa、stallorder-product-qa（規則與驗收），anysearch（官方資料），computer-use／專案 Playwright（介面）。本輪未引入 UI 套件或第三方設計系統。完整 skills 清單由本次 Codex catalog 提供，並非全部適用。
