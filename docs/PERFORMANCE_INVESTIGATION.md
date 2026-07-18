# StallOrder 正式環境效能調查

## 調查範圍

- 基準版本：`d62dd89f6760285f34ce41306263c16256459183`
- 分支：`performance/production-response-time`
- 正式站量測來源：`https://stallorder-platform.vercel.app`
- 套件管理：npm 11；`package.json` 要求 Node.js 24。
- 框架：Next.js 16.2.10、React 19.2.4、Prisma 6.19、Supabase PostgreSQL／Edge Functions。
- Chrome DevTools Performance MCP 在本次工作環境不可用；瀏覽器數據由 Playwright Navigation／Resource Timing 取得，這項限制不影響 HTTP 與資料庫測量。

## 已量測瓶頸

正式站修改前的 warm P75：

| 路由 | Warm P75 | 判讀 |
| --- | ---: | --- |
| `/` | 279.8 ms | 公開頁基準正常，但原先被不必要的 `force-dynamic` 標記。 |
| `/login` | 273.8 ms | 頁面本身正常。 |
| `/api/health` | 1,006.6 ms | 單一 `SELECT 1` 已需約一秒，強烈指向跨區／連線成本。 |
| `/staff/:stallSlug` | 6,641.9 ms | Session、權限、請求內逾期維護及六組初始查詢的往返疊加。 |
| `/merchant/dashboard` | 5,212.9 ms | Layout 與 Page 重複解析 Session／Workspace，且儀表板資料另由 API 載入。 |

Vercel Deployment API 確認正式 Function 為 `iad1`；Supabase Management API 確認正式資料庫為 `ap-northeast-1`。`pg_stat_statements` 顯示多數業務 SQL 本身低於 5 ms，故數秒回應不能歸因為單一慢 SQL。

## API 路由清冊

| Method | Route | 實作 |
| --- | --- | --- |
| POST | `/api/admin/organizations/:organizationId/additional-stalls` | `src/app/api/admin/organizations/[organizationId]/additional-stalls/route.ts` |
| POST | `/api/auth/login` | `src/app/api/auth/login/route.ts` |
| POST | `/api/auth/logout` | `src/app/api/auth/logout/route.ts` |
| POST, GET | `/api/cron/process-orders` | `src/app/api/cron/process-orders/route.ts` |
| GET | `/api/cron/report-deliveries` | `src/app/api/cron/report-deliveries/route.ts` |
| GET | `/api/health` | `src/app/api/health/route.ts` |
| POST | `/api/invitations/:token/accept` | `src/app/api/invitations/[token]/accept/route.ts` |
| GET | `/api/merchant/dashboard/overview` | `src/app/api/merchant/dashboard/overview/route.ts` |
| PATCH | `/api/merchant/organizations/:organizationId/alerts/:alertId` | `src/app/api/merchant/organizations/[organizationId]/alerts/[alertId]/route.ts` |
| GET | `/api/merchant/organizations/:organizationId/catalog/export` | `src/app/api/merchant/organizations/[organizationId]/catalog/export/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/catalog/image` | `src/app/api/merchant/organizations/[organizationId]/catalog/image/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/catalog/import` | `src/app/api/merchant/organizations/[organizationId]/catalog/import/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/catalog` | `src/app/api/merchant/organizations/[organizationId]/catalog/route.ts` |
| DELETE | `/api/merchant/organizations/:organizationId/invitations/:invitationId` | `src/app/api/merchant/organizations/[organizationId]/invitations/[invitationId]/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/invitations` | `src/app/api/merchant/organizations/[organizationId]/invitations/route.ts` |
| PATCH | `/api/merchant/organizations/:organizationId/memberships/:membershipId` | `src/app/api/merchant/organizations/[organizationId]/memberships/[membershipId]/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/product-notes` | `src/app/api/merchant/organizations/[organizationId]/product-notes/route.ts` |
| PATCH, DELETE | `/api/merchant/organizations/:organizationId/report-schedules/:scheduleId` | `src/app/api/merchant/organizations/[organizationId]/report-schedules/[scheduleId]/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/report-schedules/:scheduleId/test` | `src/app/api/merchant/organizations/[organizationId]/report-schedules/[scheduleId]/test/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/report-schedules` | `src/app/api/merchant/organizations/[organizationId]/report-schedules/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/stalls/batch-ordering` | `src/app/api/merchant/organizations/[organizationId]/stalls/batch-ordering/route.ts` |
| POST | `/api/merchant/organizations/:organizationId/stalls` | `src/app/api/merchant/organizations/[organizationId]/stalls/route.ts` |
| POST | `/api/merchant/reports/export` | `src/app/api/merchant/reports/export/route.ts` |
| PATCH | `/api/merchant/stalls/:stallId/business-hours` | `src/app/api/merchant/stalls/[stallId]/business-hours/route.ts` |
| PATCH | `/api/merchant/stalls/:stallId/memberships/:membershipId` | `src/app/api/merchant/stalls/[stallId]/memberships/[membershipId]/route.ts` |
| POST | `/api/merchant/stalls/:stallId/memberships` | `src/app/api/merchant/stalls/[stallId]/memberships/route.ts` |
| PATCH | `/api/merchant/stalls/:stallId/modules` | `src/app/api/merchant/stalls/[stallId]/modules/route.ts` |
| PATCH | `/api/merchant/stalls/:stallId/products/:productId` | `src/app/api/merchant/stalls/[stallId]/products/[productId]/route.ts` |
| PATCH | `/api/merchant/stalls/:stallId/products` | `src/app/api/merchant/stalls/[stallId]/products/route.ts` |
| PATCH | `/api/merchant/stalls/:stallId` | `src/app/api/merchant/stalls/[stallId]/route.ts` |
| GET, POST | `/api/merchant/stalls/:stallId/templates` | `src/app/api/merchant/stalls/[stallId]/templates/route.ts` |
| POST | `/api/onboarding` | `src/app/api/onboarding/route.ts` |
| OPTIONS, POST | `/api/public-order/:functionName` | `src/app/api/public-order/[functionName]/route.ts` |
| GET, POST | `/api/stalls/:stallSlug/cash-shifts` | `src/app/api/stalls/[stallSlug]/cash-shifts/route.ts` |
| PATCH, DELETE | `/api/stalls/:stallSlug/categories/:categoryId` | `src/app/api/stalls/[stallSlug]/categories/[categoryId]/route.ts` |
| POST | `/api/stalls/:stallSlug/categories` | `src/app/api/stalls/[stallSlug]/categories/route.ts` |
| PATCH | `/api/stalls/:stallSlug/order-items/batch` | `src/app/api/stalls/[stallSlug]/order-items/batch/route.ts` |
| PATCH | `/api/stalls/:stallSlug/ordering` | `src/app/api/stalls/[stallSlug]/ordering/route.ts` |
| PATCH | `/api/stalls/:stallSlug/orders/:orderId/items/:itemId` | `src/app/api/stalls/[stallSlug]/orders/[orderId]/items/[itemId]/route.ts` |
| PATCH | `/api/stalls/:stallSlug/orders/:orderId/items` | `src/app/api/stalls/[stallSlug]/orders/[orderId]/items/route.ts` |
| PATCH | `/api/stalls/:stallSlug/orders/:orderId` | `src/app/api/stalls/[stallSlug]/orders/[orderId]/route.ts` |
| POST | `/api/stalls/:stallSlug/orders/:orderId/verify-pickup` | `src/app/api/stalls/[stallSlug]/orders/[orderId]/verify-pickup/route.ts` |
| GET, POST | `/api/stalls/:stallSlug/orders` | `src/app/api/stalls/[stallSlug]/orders/route.ts` |
| GET | `/api/stalls/:stallSlug/orders/stream` | `src/app/api/stalls/[stallSlug]/orders/stream/route.ts` |
| GET, POST | `/api/stalls/:stallSlug/print-jobs` | `src/app/api/stalls/[stallSlug]/print-jobs/route.ts` |
| PATCH, DELETE | `/api/stalls/:stallSlug/products/:productId` | `src/app/api/stalls/[stallSlug]/products/[productId]/route.ts` |
| POST | `/api/stalls/:stallSlug/products` | `src/app/api/stalls/[stallSlug]/products/route.ts` |
| PATCH | `/api/stalls/:stallSlug/table-checkout` | `src/app/api/stalls/[stallSlug]/table-checkout/route.ts` |
| PATCH | `/api/stalls/:stallSlug/tables/:tableId/service-state` | `src/app/api/stalls/[stallSlug]/tables/[tableId]/service-state/route.ts` |
| GET | `/api/stalls/:stallSlug/tables` | `src/app/api/stalls/[stallSlug]/tables/route.ts` |

非 `/api` Route Handler：`src/app/auth/google/route.ts`、`src/app/auth/callback/route.ts`。Supabase Edge Functions：`create-order-session`、`create-public-order`、`get-public-order`。

## Server Actions

全專案搜尋不到 `"use server"`；目前沒有 Next.js Server Actions，寫入均經 Route Handler 或受信任 Edge Function。

## Server Component 資料存取

下列頁面會直接或透過授權／報表 helper 查詢資料庫：

- 公開／能力連結：`src/app/q/[qrToken]/page.tsx`、`src/app/delivery/[stallSlug]/page.tsx`、`src/app/invite/[token]/page.tsx`。
- 商家：`src/app/merchant/layout.tsx`、`merchant/dashboard/page.tsx`、`merchant/catalog/page.tsx`、`merchant/localization/**`、`merchant/operations/page.tsx`、`merchant/reports/**`、`merchant/report-schedules/page.tsx`、`merchant/stalls/**`、`merchant/subscription/page.tsx`、`merchant/team/page.tsx`。
- 工作區選擇：`src/app/onboarding/page.tsx`、`select-organization/page.tsx`、`select-stall/page.tsx`。
- 店員：`src/app/staff/[stallSlug]/page.tsx`、`cash/page.tsx`、`floor/page.tsx`、`print/page.tsx`。

## 關鍵流程

### Prisma 與連線

- Schema：`prisma/schema.prisma`；runtime 使用 `DATABASE_URL`，migration 使用 `DIRECT_URL`。
- `src/lib/prisma.ts` 已是 Lazy Singleton；Development 以 `globalThis` 保存，Production 每個 Function instance 一個 client。
- `prisma/seed.ts` 的獨立 `new PrismaClient()` 僅供一次性 seed，未進入 Request path。

### Root Layout 與 Rendering

- `src/app/layout.tsx` 不讀取 `cookies()`、`headers()`、Session 或資料庫。
- 不需要為了效能進行大規模 Route Group 搬移；商家已有 `src/app/merchant/layout.tsx`。
- `src/app/page.tsx` 原本被 `force-dynamic`，現已移除。
- `src/lib/auth.ts`、`src/lib/workspace.ts` 使用 React request cache，避免 Layout 與 Page 在同一 RSC request 重查 Session／Workspace。

### 公開 QR

- 原流程：`src/components/qr-order-flow.tsx` 首次 mount 後才呼叫 `create-order-session`，Edge 回應同時包含 Session 與完整菜單。
- 新流程：`src/app/q/[qrToken]/page.tsx` 先取得短 TTL 公開菜單；Client 同步顯示菜單並平行建立 Session／Turnstile。
- 訂單只可由 `supabase/functions/create-public-order/index.ts` 建立；價格、供應、QR 狀態、Turnstile、Rate Limit、Session 與 Idempotency 均維持伺服器驗證。
- Staging 驗證發現 `src/app/api/public-order/[functionName]/route.ts` 對 Supabase Cloudflare 入口自行設定保留的 `cf-connecting-ip`，可重現 Cloudflare Error 1000。Proxy 現在 Production 只信任 Vercel 的單一 `x-vercel-forwarded-for`，並僅以上游自訂 `x-real-ip` 傳給 Edge Function；rate-limit IP 維度保留且不可由一般 client header 覆寫。

### 商家儀表板

- `src/lib/dashboard-data.ts` 已使用 `daily_stall_summaries`，沒有把歷史訂單載入 Node.js 聚合。
- Summary 查詢現在與「刷新警示後讀取警示」鏈平行；資料列先按 stall 建 Map，移除每攤位重複 `filter()`。

### 店員訂單

- 初始頁面在授權後將訂單、模組、付款、折扣、商品目錄與 server clock 平行查詢。
- 原本每次頁面／輪詢都同步執行 `expire_unconfirmed_orders()`；已改由既有每分鐘 `pg_cron` 維護，避免每次 Vercel request 多一次跨區往返。
- 即時訂單仍由 `src/app/api/stalls/[stallSlug]/orders/stream/route.ts` 提供，不需手動重整。

## 既有快取、排程、圖片、日誌與測試

- 修改前沒有菜單 Data Cache、`cacheTag` 或 `revalidateTag`。
- 修改前 Supabase 同時有資料庫原生逾期工作與呼叫 Vercel `/api/cron/process-orders` 的重複工作；詳見 `docs/SCHEDULED_JOB_AUDIT.md`。
- 商品上傳原先保留最高 5MB 原圖，QR 清單用 CSS background 下載原圖；現改為 800px WebP 上傳及受限 Supabase Storage 網域的 Next Image。
- 原有 `src/lib/audit.ts` 提供安全稽核 JSON；新增 `src/lib/performance-timing.ts` 與 Edge 共用計時器。
- 修改前沒有正式效能測試；新增 `scripts/measure-production-performance.mjs`。

## 不採用項目

- 沒有引入 Redis、Read Replica、Microservice 或多 Vercel region。
- 沒有根據猜測新增索引；目前 `pg_stat_statements` 不支持盲目加索引。
- 沒有公開快取 Session、訂單狀態、付款、取餐碼、Rate Limit 或已驗證身份回應。
