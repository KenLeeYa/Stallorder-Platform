# StallOrder 效能最佳化結果

> 2026-07-28 的最新深度優化與量測請以
> `docs/performance/DEEP_ACCESS_OPTIMIZATION_20260728.md` 為準。本文件以下內容保留
> 前一輪 P0 至 P4 的歷史基準，不代表目前 DNS、Production region 或測試數量。

## 範圍與發布狀態

- 分支：`performance/cache-and-response-optimization`。
- 比較基準：Production commit `d62dd89f6760285f34ce41306263c16256459183`。
- 最終 runtime Preview：`dpl_9nCd4XNKGjnFWvW3rpabM4TQHzV7`，commit `7ce1182e2e395cf8a69d8d8b31bf19a58cc8aa40`，Vercel API 驗證 `READY`、`regions=["hnd1"]`。
- 目前 Production 仍是 `d62dd89f`、deployment `dpl_ALPBiwEDtjhPAxYi1zKD5qQkVEJW`、`regions=["iad1"]`；本分支尚未合併，也沒有直接改 production alias。
- Supabase Production 與 Staging 均為 Tokyo `ap-northeast-1`。
- `app.qidaigo.com` 在最終檢查時沒有可解析 DNS record；Vercel production hostname 可用。失敗證據位於 `docs/performance/PRODUCTION_DOMAIN_DNS_FAILURE.md`。

## 已確認瓶頸

1. Production `iad1` 到 Supabase Tokyo 的跨區 DB round trip：原始 `/api/health` warm P75 約 1,005 ms，Preview `hnd1` 約 114 ms。
2. 公開首頁與登入頁原本為 Dynamic/MISS；改成 Static 與 CDN cache 後 warm P75 約 23 ms。
3. QR session 在已取得伺服器菜單時仍重查並回傳完整菜單；`includeMenu=false` 後 query count 由 16 至 18 降為 8。
4. 到期訂單同時被 pg_cron、舊 Preview cron 與 request path 掃描；Production `pg_stat_statements` 顯示 expiry function 3,892 calls、總計 26,485 ms。
5. Staff 與 dashboard 初始 bundle 同步載入 Supabase Realtime；改成 SSE/延後 fallback 後各減少約 56.6 KB。
6. 剩餘長尾主要在 Supabase Edge cold start、Vercel deployment cold/queue 與外部網路，不以單次總時間猜測為 PostgreSQL 問題。

## 階段結果

| 階段 | 主要變更 | 獨立量測結論 |
| --- | --- | --- |
| Baseline | 安全量測工具、架構稽核 | Production health warm P75 1,006.6 ms；Production region `iad1` |
| P0 | `hnd1`、pooler/Prisma/timing | health warm P75 115.3 ms，較基準改善 88.5% |
| P1 | Static public routes、Data/CDN cache、invalidation | `/`、`/login` anonymous cache HIT；公開菜單 warm total P75 25.1 ms |
| P2 | query waterfall、N+1、expiry ownership | QR session query 16–18 -> 8；staff/dashboard/report Preview warm P75 266.9/200.4/222.1 ms |
| P3 | image、bundle、lazy loading、Suspense、RUM | staff/dashboard 初始 JS 各約 -56.6 KB；mobile LCP 972 -> 792 ms、1,148 -> 744 ms |
| P4 | 文件提案 | 沒有 runtime/DNS/Worker 變更；不建立第二套量測假象 |

各輪原始 JSON 與 Markdown 位於 `performance-results/`、`docs/performance/`。P3 保留首次部署與暖機確認兩輪；以下 after 使用暖機確認值。

## Before/After

公開路由 before 取初始 Production baseline；QR 與實際 authenticated routes 因基準未提供測試憑證，使用最早完整的 P1 authenticated measurement。Cold-like 是第一筆 `no-cache` 要求，不保證每次都觸發真正 Function cold start。

| 路由 | Cold TTFB before | Cold TTFB after | Warm median before | Warm median after | Warm P75 before | Warm P75 after | Cache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/` | 341.0 ms | 77.9 ms | 252.1 ms | 22.9 ms | 252.2 ms | 23.4 ms | MISS -> HIT |
| `/login` | 294.9 ms | 67.1 ms | 256.7 ms | 22.5 ms | 258.3 ms | 22.8 ms | MISS -> HIT |
| `/onboarding` | 302.0 ms | 321.3 ms | 251.6 ms | 134.3 ms | 252.1 ms | 134.5 ms | private MISS |
| `/api/health` | 1,038.5 ms | 161.4 ms | 1,000.0 ms | 111.8 ms | 1,004.8 ms | 113.6 ms | no-store |
| `/q/:qrToken` | 379.9 ms | 250.5 ms | 124.4 ms | 121.6 ms | 126.6 ms | 135.3 ms | private MISS |
| public menu API | 285.2 ms | 200.5 ms | 141.3 ms | 127.7 ms | 146.0 ms | 130.0 ms | anonymous HIT；auth/cookie BYPASS |
| `/staff/:stallSlug` | 374.9 ms | 250.7 ms | 246.2 ms | 187.1 ms | 246.3 ms | 189.5 ms | private MISS |
| `/merchant/dashboard` | 629.5 ms | 249.4 ms | 184.8 ms | 183.0 ms | 185.3 ms | 185.2 ms | private MISS |
| `/merchant/reports` | 706.0 ms | 572.6 ms | 190.2 ms | 167.4 ms | 199.7 ms | 174.9 ms | private MISS |

`/onboarding` cold-like 未改善，但 warm P75 明顯下降；不把 cold sample 波動隱藏。P3 首輪 public menu 曾有 15.5 秒連線離群值，而應用層同時間僅 25.2 至 42.9 ms，第二輪恢復，因此沒有回退程式碼。

## Cache 與 Rendering

- Build 最終確認 `/`、`/login`、`/offline`、`/staff/login` 為 Static；authenticated、QR、tracking 與 API 保持 Dynamic。
- `/` 使用 Vercel/CDN 長效 shared cache；`/login` 使用較短 shared cache。
- public menu 只在 anonymous、無 cookie、無 Authorization 時回 shared-cache headers；cookie/auth 測試均為 private bypass。
- 菜單 Data Cache 使用 stable tag helper，商品、分類、價格、註記、供應、售罄、攤位與接單狀態修改都會失效。
- QR HTML、order session、order creation、tracking、staff、merchant、payment、pickup code、health 與 audit 不公開快取。
- `create-public-order` 仍重讀官方價格與可售狀態，UI cache 不是交易真實來源。

## Database 與排程

- Runtime `DATABASE_URL` 已由安全布林 profile 驗證為 Supabase Transaction Pooler、port 6543、`pgbouncer=true`；`DIRECT_URL` 為 5432 migration/admin 路徑。
- Production/Preview 的 Sensitive env 名稱存在，但值無法讀回；Preview -> Staging、Production -> Production 的來源對應仍需在 Vercel Dashboard 人工複核。
- `src/lib/prisma.ts` 是 lazy singleton；request path 沒有額外 `new PrismaClient()`。
- 登入、OAuth、dashboard、QR session 與 public tracking 的獨立查詢已平行化；CSV、商品供應與桌位座標的 N+1 改成 set-based SQL。
- 沒有新增 index：目前 pg_stat/query-plan 證據不足，避免盲目增加 write/storage 成本。
- 新 migration 會在確認 native expiry pg_cron active 後移除重複 Preview cron；request path 不再執行全域 expiry scan。此 migration 尚未套用 Production。

## 前端交付

- 商品上傳會 rotate、限制 40 MP、縮到 800 x 800 內並輸出 WebP；1,948,131 B 測試 JPEG 轉為 179,346 B，縮減 90.8%。
- 只對核准的 Supabase `product-images` public path 使用 `next/image`；外部 HTTPS URL 不由 server proxy，採 lazy、no-referrer 圖片。
- Staff 先用同源 SSE，失敗才 dynamic import Realtime；dashboard 在初始 overview 後延遲載入 Realtime。
- Turnstile widget 在開始選購後才載入，但 server-side Turnstile 驗證、rate limit、QR session、idempotency 與價格驗證未改。
- Vercel Analytics/Speed Insights 已掛載並去識別 URL。Preview 未觀察到遙測 request，需在 Production 儀表板確認開始收樣。

## 驗證結果

| 驗證 | 結果 |
| --- | --- |
| `npm ci` | 通過；Prisma Client 產生成功 |
| `npm run lint` | 通過 |
| `npm run typecheck` | 通過 |
| `npm test` | 46 files、178 tests 通過 |
| `npm run db:test` | 16 files、264 pgTAP tests 通過 |
| `npx supabase db lint --level warning` | 0 schema warning/error |
| `npm run build` | 通過；33 static pages 產生完成 |
| `npm run test:e2e` | 30/30 通過 |
| `npm audit --audit-level=moderate` | 0 vulnerability |
| Pixel 7 Preview QA | QR/dashboard 無 overflow；商品圖載入；登入成功；0 hydration error |
| Local production build measurement | 8 routes；0 warning；QR session HTTP 201 |
| Production read-only control | Vercel hostname 可用；舊版 health warm P75 983.3 ms |

E2E 因 React 19/Next streaming 會保留隱藏 route tree，兩個 strict locator 改為只查目前可存取的 `main`；截圖確認沒有可見重複 UI。Staging 隔離 QA 組織與 profile 已清除。

## 安全回歸

- pgTAP 持續驗證 RLS、跨 tenant/stall 拒絕、匿名不可直接寫 order 與 QR abuse controls。
- Playwright 驗證跨組織 dashboard 404、跨攤位 order 403、公開 cache auth/cookie bypass、Turnstile 測試提交與 recovery。
- RLS、RBAC、CSRF、Google OAuth、session、Turnstile、rate limit、QR one-time session、idempotency、server-side price、state machine、audit 與 pickup protection 均未停用。
- 量測產物未保存 response body、cookie、密碼、session、Authorization、Vercel share URL 或原始 QR token。

## 已知限制與下一步

1. P3 confirmation 的 order-session desktop 為 1,174.5 ms，仍高於 800 ms；mobile 767.8 ms。下一輪應優先觀察 Supabase Edge cold start，不先引入 Redis/read replica。
2. Preview 分享環境觀察到 2 筆 CSP console error，但 0 hydration/network error；正式 hostname 修復後需在無 Vercel share injection 的環境複驗。
3. `app.qidaigo.com` DNS 目前無 record，是正式手機測試的獨立阻擋項；不得以改程式掩蓋。
4. 組織直接 cascade 刪除會因既有 membership usage-event trigger 順序造成 FK 錯誤；本次 QA 清理以先刪 membership 完成。這是非本次效能範圍的資料生命週期缺口，應另開修正。
5. PR 通過後依序：人工複核 env scope、套用 Production cron migration、部署三個已驗證 Edge Function 版本、部署 Vercel Production、修復/驗證 DNS 與 TLS、跑 production smoke，再觀察至少一個營業週期。
6. P4 Cloudflare Worker 只在 `docs/FUTURE_CLOUDFLARE_MENU_CACHE.md` 提案，沒有部署、沒有 full-site proxy，也不應在現有 Vercel cache 已達標時實作。
