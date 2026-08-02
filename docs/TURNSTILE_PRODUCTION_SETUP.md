# Cloudflare Turnstile Production 設定

## USER ACTION REQUIRED

Cloudflare connector 不是必要條件。使用者需登入 Cloudflare Dashboard：`Turnstile` → `Add Site`。

```text
Widget name: StallOrder Production
Mode: Managed
Allowed hostname: app.qidaigo.com
```

建立後取得：

- Site Key：設定為 Vercel Production `NEXT_PUBLIC_TURNSTILE_SITE_KEY=<PRODUCTION_TURNSTILE_SITE_KEY>`。
- Secret Key：設定為 Supabase Production `TURNSTILE_SECRET_KEY=<PRODUCTION_TURNSTILE_SECRET_KEY>`。

Secret Key 不得放 Vercel client variable、GitHub log、`.env.example`、文件或 PR。Staging 應使用不同 Widget／Secret 與實際 Preview 或 staging hostname。

## Server-side 驗證

`supabase/functions/create-public-order/index.ts` 必須保留 server-side Siteverify；browser widget 成功不能直接視為訂單合法。伺服器同時驗證：

- `success=true`
- token 未過期、未 replay、非 forged
- hostname 等於環境設定
- action 符合點餐用途
- Turnstile Secret 為該環境專用
- session、QR、stall、rate limit、idempotency 與 server-side price 仍全部通過

Turnstile 不是唯一防濫用控制，不能移除短效單次 session 或多維 rate limiting。

## Production 固定設定

```text
TURNSTILE_EXPECTED_HOSTNAME=app.qidaigo.com
TURNSTILE_ALLOW_TEST_KEYS=false
```

Production readiness 若發現 test key 或 `TURNSTILE_ALLOW_TEST_KEYS=true` 必須失敗。Preview 不得使用 Production secret。

## 驗證案例

1. Valid token：訂單才可進入後續交易驗證。
2. Invalid／forged token：拒絕，generic error。
3. Expired token：拒絕。
4. Replayed token：拒絕。
5. Wrong hostname：拒絕。
6. Wrong action：拒絕。
7. Turnstile service timeout：fail closed，不建立訂單。

`npm run production:smoke` 在指定 `PRODUCTION_TEST_QR_URL` 時會確認 CSP 允許 Turnstile、QR 頁面可載入，並經正式同源 proxy 建立不含訂單的短效安全 session；真正的 widget 互動與 Siteverify 測試必須在 Staging 完成，Production 只用受控測試 QR 做非破壞性驗證。

## Incident／輪替

Secret 疑似外洩時：暫停 QR ordering、在 Cloudflare rotate secret、更新 Supabase secret、重新部署／驗證 Function、查看 `public_order_attempts` 與 Edge logs，確認後再恢復。舊 secret 不得保留於文件或 CI artifacts。
