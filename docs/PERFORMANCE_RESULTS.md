# StallOrder 效能改善結果

## 比較方法

- Before：Production commit `d62dd89f6760285f34ce41306263c16256459183`。
- After：本分支 Preview／Staging，待部署後記錄 immutable deployment URL 與 commit。
- 工具：`scripts/measure-production-performance.mjs`，同一組 routes、sample count、測試帳號權限與 synthetic mobile 設定。
- Production 僅執行 read-only route；不建立正式訂單。
- 完整原始結果保存於 `performance-results.json`；不保存 response body、Cookie 或 credential。

## 修改前

| Route | Cold total | Warm P75 | 判讀 |
| --- | ---: | ---: | --- |
| `/` | 297.2 ms | 279.8 ms | 正常 |
| `/api/health` | 1,045.4 ms | 1,006.6 ms | 跨區單 DB round trip 過高 |
| `/q/:qrToken` page shell | 287.6 ms | 258.8 ms | Shell 快，但菜單原先等待 client Edge response |
| `/staff/:stallSlug` | 5,911.3 ms | 6,641.9 ms | 多輪 auth／DB／maintenance 往返 |
| `/merchant/dashboard` | 3,681.3 ms | 5,212.9 ms | session/workspace 重複與 serial query |

Function region：`iad1`。Supabase：`ap-northeast-1`。

## Preview／Staging 修改後

部署與完整驗證尚未執行。本節只能由實際 Vercel deployment API、runtime logs 與同一量測腳本填寫，不以本機推估。

| Route | Cold total | Warm P75 | 改善率 |
| --- | ---: | ---: | ---: |
| `/` | pending | pending | pending |
| `/api/health` | pending | pending | pending |
| `/q/:qrToken` | pending | pending | pending |
| `/staff/:stallSlug` | pending | pending | pending |
| `/merchant/dashboard` | pending | pending | pending |

After Function region：pending，接受條件為 `hnd1`。

## 本機 production build 對照

2026-07-19 以 `next start`、本機 Supabase、同一量測腳本及 6 次 request 執行。此結果用來確認程式端改善與效能預算，不拿來取代 Vercel／Supabase 跨區前後比較。

| Route | Cold total | Warm P75 | Warm TTFB P75 | Android LCP |
| --- | ---: | ---: | ---: | ---: |
| `/` | 498.6 ms | 110.3 ms | 68.8 ms | 852 ms |
| `/api/health` | 14.8 ms | 15.8 ms | 15.3 ms | 204 ms |
| `/q/:qrToken` | 107.3 ms | 33.8 ms | 28.6 ms | 620 ms |
| `/staff/:stallSlug` | 278.7 ms | 116.7 ms | 23.1 ms | 576 ms |
| `/merchant/dashboard` | 112.9 ms | 66.1 ms | 52.0 ms | 940 ms |

- 8 條量測路由均未觸發伺服器端 budget warning。
- QR 頁的 `create-order-session` 外部呼叫在桌面樣本為 342.8 ms、Android 樣本為 148.3 ms；它已與可快取菜單首屏分離，但仍是後續可觀測項目。
- `/staff/:stallSlug` 與 dashboard 的桌面 LCP 單次樣本受本機 Chromium 啟動／排程影響，因此以 Preview Speed Insights 與重複樣本作正式判讀。

## 已實作改善

- Vercel 單一 `hnd1` region。
- Prisma lazy singleton 與安全 pooler profile。
- API／Edge structured timing 與 Server-Timing。
- 公開菜單短 TTL cache、完整 mutation invalidation、首屏與安全 session 初始化分離。
- React request cache、獨立查詢平行化、移除 request-path maintenance。
- 多攤位 catalog copy 由 N+1 upsert 改為單一 set-based DML。
- WebP 商品圖、受限 Next Image、loading skeleton、Analytics 與 Speed Insights。

## 尚待量測

- Preview 真實 Function duration 與 dbMs。
- Edge Function session／Turnstile breakdown。
- 修改後 JS／image transfer 與 mobile LCP。
- 一個完整營業週期的 Supabase connections、CPU 與 Vercel P75／P95。
