# Rendering 與 Cache 邊界

## Root layout 檢查

`src/app/layout.tsx` 只包含 metadata、字型、全域 CSS 與 `PwaRuntime`，沒有呼叫 `cookies()`、`headers()`、session resolver 或 Prisma。公共頁面原本不是被 root layout 強制 Dynamic，因此沒有為了形式而搬動整個 App Router 目錄。

安全邊界仍由各 authenticated page／API 的 `requirePagePermission`、`authorizeApiRequest`、`authorizeOrganizationApiRequest`、RBAC 與 CSRF 驗證負責。檔案不搬入 route groups，URL 與現有權限行為皆不變。

## P1 build 證據

| Route | P0 | P1 | 原因 |
| --- | --- | --- | --- |
| `/` | Dynamic | Static | 移除無資料來源的 `force-dynamic` |
| `/login` | Dynamic | Static | query string 改由 Client Form 讀取；登入與 OAuth redirect 仍由伺服器清理 |
| `/onboarding` | Dynamic | Dynamic | 必須讀取 authenticated principal，未為追求 Static 而降低安全性 |
| `/q/[qrToken]` | Dynamic | Dynamic + Data Cache | Route 含 QR context；只有公開菜單資料使用短效 cache |
| `/delivery/[stallSlug]` | Dynamic | Dynamic + Data Cache | 仍需查有效外送 QR；菜單 payload 可重用 |
| Merchant／Staff／Kitchen／Reports | Dynamic | Dynamic | 含 tenant、RBAC、訂單或財務資料，禁止 public cache |

`npm run build` 在 P1 顯示 `/`、`/login`、`/offline`、`/staff/login` 與 manifest 為 Static；其餘受保護或交易路由維持 Dynamic。

## Public page CDN policy

`next.config.ts` 只對 `/` 與 `/login` 設定明確 shared-cache header：

- Browser：`public, max-age=0, must-revalidate`。
- `/` Vercel CDN：1 小時 fresh、24 小時 stale-while-revalidate。
- `/login` Vercel CDN：5 分鐘 fresh、1 小時 stale-while-revalidate。
- 新 deployment 會產生新 immutable asset URL；HTML 不包含 session、CSRF、使用者或商戶資料。

`/onboarding`、`/auth/*`、`/api/auth/*`、`/order/*`、staff、merchant、kitchen、checkout 與 public-order proxy 不套用這組 header。

## Login query handling

`LoginForm` 使用 `useSyncExternalStore` 讀取瀏覽器 query string，SSR snapshot 固定為空字串，因此 Static HTML 不會包含訪客資料。`next` 最終仍由：

1. `/api/auth/login` 的 `sanitizeRedirectPath`；
2. `/auth/google` 的 `sanitizeRedirectPath`

在伺服器驗證，Client 端內容不作為可信 redirect 依據。

## 回復方式

若 Static login 或 CDN header 發生相容問題，只回復 `src/app/page.tsx`、`src/app/login/page.tsx`、`src/components/login-form.tsx` 與 `next.config.ts` 的 P1 commit；不需更動資料庫、RLS、session 或 OAuth 設定。
