# StallOrder 深度存取效能優化

## 範圍

- 分支：`performance/deep-access-optimization`
- 基準：2026-07-28 `staging.qidaigo.com`
- 最終隔離 Preview：`https://stallorder-platform-lc40in5bv-ada76145-8663s-projects.vercel.app`
- Vercel deployment：`dpl_FdCetLMA3wp553bvGha7uBwn5akQ`
- Vercel Function：已由 `vercel inspect` 驗證為 `hnd1`
- 資料來源：Preview 環境變數所連接的 Staging 資料庫
- 量測方式：每條路由第一筆 cold-like，後續七筆 warm；瀏覽器另使用 80 ms RTT、4 Mbps 的合成 Android 網路

Preview 受 Vercel Deployment Protection 保護。量測使用短效 OIDC header，
沒有關閉保護，也沒有保存帳密、Cookie、Session、QR token 或回應本文。

## 已確認瓶頸

1. KDS 與其他 Client Component 從共用 contract 匯入 Zod schema，導致 Zod 一併進入瀏覽器 bundle。
2. KDS 頁面先載入完整 workspace，再重做一次攤位授權；功能權限檢查也會讀取完整方案、全部 entitlement、核准與 add-on 資料。
3. Staff 首頁重複讀取 `stall_ordering_settings`，並用資料庫查詢取得只需由應用伺服器產生的目前時間。
4. 容量功能為三個 Feature 重複載入相同 subscription context。
5. Merchant dashboard 首次呈現後才從瀏覽器要求 overview，造成可見資料的第二段 waterfall。
6. Workspace 查詢載入的欄位多於各頁實際使用範圍。

## 實作

### Server 與資料庫

- Workspace 改為精準 `select`，保留組織、攤位、角色與狀態隔離所需欄位。
- 單一 Feature 驗證只讀取指定 entitlement 與有效 add-on code；只有方案不含該功能時才查 add-on catalog。
- Staff 設定、限制與商品目錄共用一次 ordering settings 查詢。
- 容量功能一次載入可用 entitlement，再判斷三個 Feature。
- 移除 Staff 與 KDS 為取得目前時間執行的 `select now()`。
- KDS 移除重複的攤位授權查詢；KDS board 查詢由 5 組降為 4 組。
- Dashboard 在 Server Component 載入第一屏 overview，瀏覽器沿用該資料，不再掛載後立即重打同一 API。
- KDS board API 與三個主要頁面加入安全的 `totalMs`、`authMs`、`dbMs`、`dbQueryCount` timing。

### Client bundle

將純型別、常數與純函式移到不含 Zod 的 client-safe module，server validation
仍使用原本 Zod schema。

| 路由／模組 | 優化前 entry JS | 優化後 entry JS | 結果 |
| --- | ---: | ---: | ---: |
| KDS | 約 390 KB | 105,254 B | 約 -73% |
| 商家申請 | 392,503 B | 104,872 B | -73.3% |
| CDS 取餐顯示 | 399,246 B | 114,888 B | -71.2% |
| 報表排程 | 395,098 B | 110,606 B | -72.0% |
| 商品 CSV | 458,368 B | 173,488 B | -62.1% |

`npm run performance:bundles` 會讀取 Next.js build manifest 並檢查八條重要路由，
防止 server-only validation library 再次進入 client bundle。

## Staging 基準與 Preview 結果

下表的 before 與 after 均使用相同電腦、相同 Staging QA 帳號、`hkg1` Edge PoP
及 `hnd1` Function。cold-like 不能保證觸發真正 cold start，因此以 warm P75 與
瀏覽器結果為主。

| 路由 | Warm P75 before | Warm P75 after | Android LCP before | Android LCP after |
| --- | ---: | ---: | ---: | ---: |
| `/api/health` | 121.2 ms | 113.6 ms | 236 ms | 228 ms |
| `/staff/:stallSlug` | 442.2 ms | 237.4 ms | 808 ms | 760 ms |
| `/kitchen` | 295.7 ms | 346.0 ms | 784 ms | 788 ms |
| `/merchant/dashboard` | 288.1 ms | 291.2 ms | 1,152 ms | 892 ms |
| `/merchant/reports/overview` | 365.7 ms | 260.5 ms | 792 ms | 808 ms |

可直接歸因的結果：

- Staff warm P75 改善 46.3%，cold-like 總時間由 678.7 ms 降至 320.6 ms。
- Dashboard 的 HTTP 完成時間近似不變，但第一屏已包含 overview，Android LCP 改善 22.6%。
- Reports warm P75 改善 28.8%。
- KDS 瀏覽器 JS transfer 由 244,350 B 降至 177,611 B，decoded JS 由 862,900 B 降至 578,044 B。
- KDS 的精準 Feature 查詢 A/B log 顯示，常態 auth 約由 185 ms 降至 150 ms，頁面應用層約由 277 ms 降至 235 ms。

沒有宣稱改善的項目：

- KDS 完整 HTTP stream warm P75 在兩次 Preview 確認中為 346 至 398 ms，高於本次 before 的 295.7 ms；其 TTFB 與 LCP 大致持平。應持續以 Vercel app timing 分辨 DB、RSC 串流與網路時間。
- Dashboard warm HTTP P75 大致持平。此次收益是移除首次 client waterfall 與改善可見內容時間，不是降低所有 server query 時間。
- Public menu 本輪沒有相同 token 的 before/after 對照，不從其他路由推算改善。

## 量測與安全

- `scripts/measure-response-time.mjs` 現在會對 HTTP 4xx/5xx 產生警告，不再把 404 當成無警告的成功量測。
- `/staff/orders` 是概念路徑，實際路由為 `/staff/:stallSlug`；前者的 404 必須保留為警告。
- RLS、RBAC、CSRF、Turnstile、QR session、rate limit、idempotency、伺服器端價格驗證、audit 與 tenant/stall scope 均未停用。
- Dashboard 初始資料仍為 private dynamic response；沒有新增公開 authenticated cache。
- 沒有新增 migration、index、Redis、read replica 或跨區部署。

## 驗證

| 驗證 | 結果 |
| --- | --- |
| `npm run lint` | 通過 |
| `npm run typecheck` | 通過 |
| `npm test` | 78 files、325 tests 通過 |
| `npx supabase db lint --level warning` | 0 warning/error |
| `npm run build` | 本機與 Vercel Preview 通過 |
| `npm run performance:bundles` | 8/8 路由通過 |
| KDS + multi-stall Playwright | 7/7 通過，包含跨組織拒絕與手機版 |
| 完整功能 Playwright（排除既有品牌文字案例） | 64/64 通過 |
| `npm audit --audit-level=moderate` | 0 vulnerability |

完整 E2E 在 Edge Functions 啟動後，原先 11 個失敗案例有 10 個通過。唯一剩餘
失敗是 `origin/staging` 已存在的品牌文字不一致：介面顯示「平台管理後台」，
測試期待「攤點通平台管理」。此分支沒有修改該文案。

本機 pgTAP 共有 580 項，578 項通過。兩項失敗源自共享本機 Supabase 已存在
`validate_online_payment_scope` trigger，但目前 `origin/staging` 尚未包含遠端
20260728 的四個 migration；本效能分支沒有 schema 或 migration 變更。

## 發布建議

1. 先將此分支與最新 Staging migration 來源樹整合，排除目前 schema drift。
2. 修正或更新既有平台管理品牌文字測試，再要求全綠 CI。
3. 部署 Staging，使用相同 QA 帳號重新量測 Staff、KDS、Dashboard 與 Reports。
4. Staging 功能、安全與效能驗收完成後，才將相同 tree 推進 Production。
5. Production 發布後觀察至少一個營業週期的 Speed Insights、Vercel timing 與 Supabase 指標。
