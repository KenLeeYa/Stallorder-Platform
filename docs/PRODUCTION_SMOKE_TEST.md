# Production Smoke Test

腳本：`scripts/production-smoke-test.mjs`。它只做讀取與負向授權測試，不會建立真實訂單。

## Preview

Preview smoke 由 `Ephemeral Preview Validation` 自動對 PR 專屬、data-less
Supabase Branch 所配對的 Vercel URL 執行。Vercel 自動建立的通用 Git Preview
只作 build／前端訊號，不是後端 runtime gate，也不得連到 Production Primary
或 DR。

```powershell
$env:PRODUCTION_BASE_URL='https://<ACTUAL_PREVIEW_URL>'
$env:SMOKE_SKIP_DOMAIN_REDIRECTS='true'
npm run production:smoke
```

Preview 仍必須通過主頁、health、invalid QR、靜態資產、安全標頭與未登入 merchant API；只略過 Production 的 root 公開網站與 www domain redirect。

## Production

```powershell
$env:PRODUCTION_BASE_URL='https://app.qidaigo.com'
$env:ROOT_DOMAIN_URL='https://qidaigo.com'
$env:WWW_DOMAIN_URL='https://www.qidaigo.com'
$env:PRODUCTION_TEST_QR_URL='/q/<DEDICATED_PRODUCTION_TEST_QR_TOKEN>'
$env:PRODUCTION_TEST_QR_REQUIRED='true'
npm run production:smoke
```

`PRODUCTION_TEST_QR_URL` 只能指向專用 Production test stall，且必須與
`PRODUCTION_BASE_URL` 同源並使用 `/q/<token>` 路由。Token 不寫入 Git、報告或
command history。Preview 未設定時可明確 SKIP 專用 QR 檢查；Production Apply
固定設定 `PRODUCTION_TEST_QR_REQUIRED=true`，缺少或格式錯誤會失敗，不允許 SKIP。

## 自動檢查

1. Base URL 使用 HTTPS。
2. 主應用回傳 200，沒有 debug stack trace。
3. `/api/health` 為 200／`status=ok`，不暴露 database details。
4. Invalid QR 不產生 5xx 或 stack trace。
5. 至少一個 Next.js static asset 可載入。
6. root 公開網站以原網域回傳 200 並包含 StallOrder／攤點通品牌，`www` 以永久 301／308 redirect 到 `ROOT_DOMAIN_URL`。
7. CSP、HSTS、nosniff、Referrer-Policy、Permissions-Policy、frame-ancestors 存在。
8. CSP 包含 Cloudflare Turnstile 且沒有 broad `*` wildcard。
9. 未登入 merchant report API 回傳 401／403。
10. Production 必須提供同源 `/q/<token>` test QR；頁面需成功載入，並透過正式同源 proxy 建立短效安全點餐 session（HTTP 201）。

## 人工補充驗收

- Login／Google OAuth callback、merchant/staff/kitchen route。
- Production smoke 只建立專用 QR 的短效 session，不建立訂單；Turnstile Siteverify、`WAITING_CONFIRMATION`、staff confirm、製作、完成、付款與取消防呆仍須在 Staging 完整驗證。
- 驗證 dine-in 不要求 pickup code；takeout 使用三位 pickup code。
- 確認 Realtime／SSE 新訂單不需刷新。
- 檢查 Vercel／Supabase logs 沒有 5xx、stack、secret、token 或跨租戶資料。

## 結果記錄

記錄 deployment URL、commit SHA、執行時間、每個 PASS/FAIL/SKIP 與 log reference。不要附 response cookie、authorization header、QR token、database URL 或 secret。任何 FAIL 阻擋上線；專用 QR SKIP 也阻擋正式發布。
