# StallOrder 回應時間與快取架構稽核

## 稽核基準

- Git revision：`d62dd89f6760285f34ce41306263c16256459183`
- 分支：`performance/cache-and-response-optimization`
- 套件管理：npm 11；Node.js 24；`package.json`
- 框架：Next.js 16.2.10、React 19.2.4、Prisma 6.19、Supabase PostgreSQL／Edge Functions。
- Production deployment：`dpl_ALPBiwEDtjhPAxYi1zKD5qQkVEJW`，Vercel API 於 2026-07-19 確認 `regions=["iad1"]`。
- Production Supabase：`eyuctbnlvnbnivwasvqr`，Management API 確認 `ap-northeast-1`、`ACTIVE_HEALTHY`。
- Staging Supabase：`daeqwtpaxcebmtwxqdkj`，Management API 確認 `ap-northeast-1`、`ACTIVE_HEALTHY`。
- 基準量測：`performance-results/baseline.json` 與 `docs/PERFORMANCE_BASELINE.md`。

## Rendering mode

`npm run build` 的修改前輸出：

| 路由 | 模式 | 原因／資料來源 |
| --- | --- | --- |
| `/` | Dynamic | `src/app/page.tsx` 明確設定 `force-dynamic`，但頁面沒有 request data。 |
| `/login` | Dynamic | `src/app/login/page.tsx` 解析現有 Session。 |
| `/onboarding` | Dynamic | `src/app/onboarding/page.tsx` 解析 Session／Workspace。 |
| `/q/[qrToken]` | Dynamic | Token 參數頁；初始 menu/session 全由 client Edge request 取得。 |
| `/order/[trackingToken]` | Dynamic | 私有 tracking token，不可公開快取。 |
| `/staff/login` | Static | 無 Session DB query。 |
| `/offline` | Static | 純離線說明頁。 |
| `/merchant/**` | Dynamic | `src/app/merchant/layout.tsx` 執行 Session、Workspace 與 RBAC。 |
| `/staff/[stallSlug]/**` | Dynamic | 執行 Session、stall 權限與訂單資料查詢。 |
| `/api/**` | Dynamic | Route Handlers；依路徑使用 private/no-store 或 transactional response。 |

`src/app/layout.tsx` 只提供字型、metadata、CSP 相容 PWA shell；不呼叫 `cookies()`、`headers()`、Session helper 或 Prisma。現有根 layout 不需要為效能大搬移。`cookies()` 位於 `src/lib/auth.ts` 與 `src/lib/supabase-auth.ts`，只應由需要身份的頁面呼叫。

## API 與 Server Actions

- `src/app/api/**/route.ts` 共 50 個 Route Handler。
- 額外 Route Handlers：`src/app/auth/google/route.ts`、`src/app/auth/callback/route.ts`。
- Supabase Edge Functions：`supabase/functions/create-order-session/index.ts`、`create-public-order/index.ts`、`get-public-order/index.ts`。
- 全專案沒有 `"use server"`；目前沒有 Next.js Server Actions。所有寫入經 Route Handler 或受信任 Edge Function。

API route 檔案清冊：

```text
src/app/api/health/route.ts
src/app/api/onboarding/route.ts
src/app/api/auth/login/route.ts
src/app/api/auth/logout/route.ts
src/app/api/cron/process-orders/route.ts
src/app/api/cron/report-deliveries/route.ts
src/app/api/public-order/[functionName]/route.ts
src/app/api/invitations/[token]/accept/route.ts
src/app/api/admin/organizations/[organizationId]/additional-stalls/route.ts
src/app/api/merchant/dashboard/overview/route.ts
src/app/api/merchant/reports/export/route.ts
src/app/api/merchant/stalls/[stallId]/route.ts
src/app/api/merchant/stalls/[stallId]/templates/route.ts
src/app/api/merchant/stalls/[stallId]/business-hours/route.ts
src/app/api/merchant/stalls/[stallId]/modules/route.ts
src/app/api/merchant/stalls/[stallId]/products/route.ts
src/app/api/merchant/stalls/[stallId]/products/[productId]/route.ts
src/app/api/merchant/stalls/[stallId]/memberships/route.ts
src/app/api/merchant/stalls/[stallId]/memberships/[membershipId]/route.ts
src/app/api/merchant/organizations/[organizationId]/stalls/route.ts
src/app/api/merchant/organizations/[organizationId]/stalls/batch-ordering/route.ts
src/app/api/merchant/organizations/[organizationId]/catalog/route.ts
src/app/api/merchant/organizations/[organizationId]/catalog/import/route.ts
src/app/api/merchant/organizations/[organizationId]/catalog/export/route.ts
src/app/api/merchant/organizations/[organizationId]/catalog/image/route.ts
src/app/api/merchant/organizations/[organizationId]/product-notes/route.ts
src/app/api/merchant/organizations/[organizationId]/alerts/[alertId]/route.ts
src/app/api/merchant/organizations/[organizationId]/memberships/[membershipId]/route.ts
src/app/api/merchant/organizations/[organizationId]/invitations/route.ts
src/app/api/merchant/organizations/[organizationId]/invitations/[invitationId]/route.ts
src/app/api/merchant/organizations/[organizationId]/report-schedules/route.ts
src/app/api/merchant/organizations/[organizationId]/report-schedules/[scheduleId]/route.ts
src/app/api/merchant/organizations/[organizationId]/report-schedules/[scheduleId]/test/route.ts
src/app/api/stalls/[stallSlug]/orders/route.ts
src/app/api/stalls/[stallSlug]/orders/stream/route.ts
src/app/api/stalls/[stallSlug]/orders/[orderId]/route.ts
src/app/api/stalls/[stallSlug]/orders/[orderId]/items/route.ts
src/app/api/stalls/[stallSlug]/orders/[orderId]/items/[itemId]/route.ts
src/app/api/stalls/[stallSlug]/orders/[orderId]/verify-pickup/route.ts
src/app/api/stalls/[stallSlug]/order-items/batch/route.ts
src/app/api/stalls/[stallSlug]/ordering/route.ts
src/app/api/stalls/[stallSlug]/products/route.ts
src/app/api/stalls/[stallSlug]/products/[productId]/route.ts
src/app/api/stalls/[stallSlug]/categories/route.ts
src/app/api/stalls/[stallSlug]/categories/[categoryId]/route.ts
src/app/api/stalls/[stallSlug]/tables/route.ts
src/app/api/stalls/[stallSlug]/tables/[tableId]/service-state/route.ts
src/app/api/stalls/[stallSlug]/table-checkout/route.ts
src/app/api/stalls/[stallSlug]/cash-shifts/route.ts
src/app/api/stalls/[stallSlug]/print-jobs/route.ts
```

## Prisma 與連線

- Schema：`prisma/schema.prisma`，runtime `DATABASE_URL`、migration `DIRECT_URL`。
- Request runtime 唯一 `new PrismaClient()` 位於 `src/lib/prisma.ts` 的 lazy singleton factory；Development 使用 `globalThis`，Production 每個 Function instance 重用一個 client。
- `prisma/seed.ts` 的 client 僅供一次性 seed，不在 request path。
- Vercel API 只讀確認 Production／Preview 都有 Sensitive `DATABASE_URL` 與 `DIRECT_URL`；沒有讀取或輸出值。
- 實際 pooler mode、port、`pgbouncer=true` 與 connection limit 在修改前沒有安全 runtime profile 可驗證，列入 P0。

## 主要資料查詢流程

| 流程 | 路徑 | 修改前狀態 |
| --- | --- | --- |
| Landing | `src/app/page.tsx` | 無 DB query，卻被強制 Dynamic。 |
| Login | `src/app/login/page.tsx`、`src/app/api/auth/login/route.ts` | Page 解析 Session；登入 handler 有 rate limit、密碼驗證、Session、Workspace 與 audit。 |
| Onboarding | `src/app/onboarding/page.tsx`、`src/app/api/onboarding/route.ts` | Session／Workspace 與組織建立 transaction。 |
| QR menu | `src/app/q/[qrToken]/page.tsx`、`src/components/qr-order-flow.tsx` | Client mount 後呼叫 `create-order-session`；Session 與完整 menu 綁在同一 Edge 回應，無 Next Data Cache。 |
| Staff／Kitchen | `src/app/staff/[stallSlug]/page.tsx` | 權限後先呼叫 expiry maintenance，再平行載入 orders、settings、payments、discounts、catalog、clock。 |
| Merchant dashboard | `src/app/merchant/dashboard/page.tsx`、`src/app/api/merchant/dashboard/overview/route.ts`、`src/lib/dashboard-data.ts` | Layout/Page 可能重複 Session／Workspace；summary 已使用 `daily_stall_summaries`，但 alert refresh 先於資料查詢。 |
| Reports | `src/app/merchant/reports/**`、`src/lib/report-data.ts` | 使用 bounded summary/report helpers；仍需量測 query count。 |
| Checkout | `src/app/api/stalls/[stallSlug]/table-checkout/route.ts`、`src/lib/checkout.ts` | Transactional、private，禁止公開快取。 |

直接或間接查詢 DB 的主要 Server Components 位於 `src/app/merchant/**/page.tsx`、`src/app/staff/[stallSlug]/**/page.tsx`、`src/app/delivery/[stallSlug]/page.tsx`、`src/app/invite/[token]/page.tsx`、`src/app/select-*.tsx`。公開 order tracking、authenticated data 與 financial report 均不可公開快取。

## Waterfall 與 N+1 候選

- `src/lib/auth.ts` 與 `src/lib/workspace.ts`：同一 RSC request 可能重複查 Session／Workspace。
- `src/app/staff/[stallSlug]/page.tsx`：每次頁面要求同步執行 `expire_unconfirmed_orders()`，與既有每分鐘 DB cron 重疊。
- `src/lib/dashboard-data.ts`：alert refresh 與 summary query 串行；每個 stall 以 `rows.filter()` 重掃 summary rows。
- `src/app/api/merchant/stalls/[stallId]/templates/route.ts`：transaction 內逐商品 `upsert`。
- `src/app/api/merchant/organizations/[organizationId]/catalog/import/route.ts`：逐列查 category、逐商品與逐 stall upsert。
- `src/app/api/stalls/[stallSlug]/order-items/batch/route.ts`：transaction 內逐 item 更新，涉及狀態機與 audit snapshot，不能未經證據直接平行化。
- `src/lib/report-delivery.ts`：逐 schedule transaction／外部 delivery；屬有序工作，不應盲目 `Promise.all`。

## Cache 與 no-store

- 修改前搜尋不到 `unstable_cache`、`"use cache"`、`cacheTag` 或 `revalidateTag`。
- `/`、`/login`、`/onboarding` 的 Production 回應均為 `private, no-cache, no-store` 且 `X-Vercel-Cache: MISS`。
- `src/app/api/health/route.ts`、public order proxy、order stream、staff/merchant APIs 正確使用 `no-store`，不得因 P1 改為 public。
- 商品／售罄／ordering 寫入尚無集中 cache tag invalidation。

## 排程

- `supabase/migrations/20260713000200_order_abuse_controls.sql` 已建立 DB-only expiry／cleanup job。
- `supabase/migrations/20260717042506_vercel_preview_process_orders_cron.sql` 另每五分鐘呼叫 `/api/cron/process-orders`，重做 expiry／cleanup，為 P2 重複掃描候選。
- Report delivery 的 `pg_cron` 呼叫外部 Vercel route，責任不同，不與 order expiry 混併。
- `.github/workflows/**` 沒有 production schedule；`vercel.json` 修改前沒有 Vercel Cron 定義。

## 圖片與前端傳輸

- `src/components/qr-order-flow.tsx` 以 CSS background 載入商品原圖，沒有 responsive image optimization。
- `src/app/merchant/localization/preview/page.tsx` 使用 `next/image`，但 `unoptimized`。
- `src/app/api/merchant/organizations/[organizationId]/catalog/image/route.ts` 接受最高 5 MB 原始 JPEG／PNG／WebP，未產生實用 thumbnail。
- `next.config.ts` 尚未限制 Supabase Storage `remotePatterns`。
- `"use client"` 集中在互動管理元件；P3 應以 bundle evidence 下移邊界，不大規模重寫。

## 日誌、觀測與測試

- `src/lib/audit.ts` 已提供安全結構化稽核日誌，但沒有 route timing breakdown。
- Edge Functions 只有拒絕／例外 JSON，沒有一致 `totalMs`、`dbMs`、`turnstileMs`。
- `docs/MONITORING.md` 有安全事件告警，尚無 request timing threshold。
- 修改前沒有 response-time script；P0 新增 `scripts/measure-response-time.mjs`。
- 既有測試包含 unit、Playwright 與 `supabase/tests/database/**` RLS／tenant／stall isolation。

## 修改前結論

1. Production `iad1` 到 Supabase Tokyo 的單一 health SQL warm P75 為 `1006.6 ms`，跨區是已量測而非猜測的 P0 瓶頸。
2. 公開 landing 無資料需求卻 Dynamic；public menu 沒有 native cache，是 P1 候選。
3. Query waterfall、template/import N+1 與重複 expiry cron 是 P2 候選，但索引必須等待 `pg_stat_statements`／plan 證據。
4. 商品原圖與 public client bundle 是 P3 候選；不得用 loading UI 掩蓋 backend latency。
5. 不引入 Redis、read replica、microservice、multi-region Function 或全站 Cloudflare Proxy。
