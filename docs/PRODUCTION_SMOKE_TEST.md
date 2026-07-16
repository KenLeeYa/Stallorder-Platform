# Production Smoke Test

腳本：`scripts/production-smoke-test.mjs`。它只做讀取與負向授權測試，不會建立真實訂單。

## Preview

```powershell
$env:PRODUCTION_BASE_URL='https://<ACTUAL_PREVIEW_URL>'
$env:SMOKE_SKIP_DOMAIN_REDIRECTS='true'
npm run production:smoke
```

Preview 仍必須通過主頁、health、invalid QR、靜態資產、安全標頭與未登入 merchant API；只略過尚未切換的 root／www domain redirect。

## Production

```powershell
$env:PRODUCTION_BASE_URL='https://app.qidaigo.com'
$env:ROOT_DOMAIN_URL='https://qidaigo.com'
$env:WWW_DOMAIN_URL='https://www.qidaigo.com'
$env:PRODUCTION_TEST_QR_URL='/q/<DEDICATED_PRODUCTION_TEST_QR_TOKEN>'
npm run production:smoke
```

`PRODUCTION_TEST_QR_URL` 只能指向專用 Production test stall。Token 不寫入 Git、報告或 command history；未提供時腳本會明確 SKIP widget 檢查，Go-Live checklist 必須保持未完成。

## 自動檢查

1. Base URL 使用 HTTPS。
2. 主應用回傳 200，沒有 debug stack trace。
3. `/api/health` 為 200／`status=ok`，不暴露 database details。
4. Invalid QR 不產生 5xx 或 stack trace。
5. 至少一個 Next.js static asset 可載入。
6. root 與 `www` redirect 到 `https://app.qidaigo.com`。
7. CSP、HSTS、nosniff、Referrer-Policy、Permissions-Policy、frame-ancestors 存在。
8. CSP 包含 Cloudflare Turnstile 且沒有 broad `*` wildcard。
9. 未登入 merchant report API 回傳 401／403。
10. 有提供 test QR 時，頁面載入 Turnstile widget script。

## 人工補充驗收

- Login／Google OAuth callback、merchant/staff/kitchen route。
- 專用測試攤位完成一次 QR session、Turnstile、`WAITING_CONFIRMATION`、staff confirm、製作、完成、付款與取消防呆。
- 驗證 dine-in 不要求 pickup code；takeout 使用三位 pickup code。
- 確認 Realtime／SSE 新訂單不需刷新。
- 檢查 Vercel／Supabase logs 沒有 5xx、stack、secret、token 或跨租戶資料。

## 結果記錄

記錄 deployment URL、commit SHA、執行時間、每個 PASS/FAIL/SKIP 與 log reference。不要附 response cookie、authorization header、QR token、database URL 或 secret。任何 FAIL 阻擋上線；Turnstile SKIP 也阻擋真實點餐。
