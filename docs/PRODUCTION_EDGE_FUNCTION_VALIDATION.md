# Production Edge Function 驗證

## 公開函式與信任邊界

| Function | JWT gateway | 用途 | 自行驗證 |
| --- | --- | --- | --- |
| `create-order-session` | `verify_jwt=false` | 靜態 QR 換取 10 分鐘短效 session | CORS、method、body、QR／stall／organization state、IP/device/QR rate limit、token hash |
| `create-public-order` | `verify_jwt=false` | 建立 `WAITING_CONFIRMATION` 訂單 | 上述控制、session expiry／single-use、Turnstile、idempotency、商品／註記／價格／數量、交易內消耗 session |
| `get-public-order` | `verify_jwt=false` | 以 tracking token 讀單一公開訂單 | CORS、token hash、order binding、rate limit、最小欄位回傳 |

公開函式不能改成匿名直接寫 table；只能透過 service runtime 呼叫受限 RPC。Merchant、staff、admin API 仍由 Next.js session／RBAC／CSRF 保護，不應改為公開 Edge Function。

## 實際 custom secrets

- `ABUSE_HASH_SECRET`
- `TOKEN_DERIVATION_SECRET`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_EXPECTED_HOSTNAME`
- `TURNSTILE_ALLOW_TEST_KEYS`
- `PUBLIC_APP_ORIGINS`
- `TRUSTED_CLIENT_IP_HEADER`
- `APP_ENV`

`SUPABASE_URL` 與 Supabase runtime secret/service key 由平台管理；只確認可用，不輸出。Staging 與 Production 的 custom secrets 必須完全不同。

Production 固定非機密設定：

```text
TURNSTILE_EXPECTED_HOSTNAME=app.qidaigo.com
TURNSTILE_ALLOW_TEST_KEYS=false
PUBLIC_APP_ORIGINS=https://app.qidaigo.com
TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip
APP_ENV=production
```

## 部署

```powershell
npx supabase functions deploy create-order-session --project-ref <PRODUCTION_SUPABASE_PROJECT_REF> --no-verify-jwt
npx supabase functions deploy create-public-order --project-ref <PRODUCTION_SUPABASE_PROJECT_REF> --no-verify-jwt
npx supabase functions deploy get-public-order --project-ref <PRODUCTION_SUPABASE_PROJECT_REF> --no-verify-jwt
npx supabase functions list --project-ref <PRODUCTION_SUPABASE_PROJECT_REF>
npx supabase secrets list --project-ref <PRODUCTION_SUPABASE_PROJECT_REF>
```

Secret list 只核對名稱與 presence；不得截圖或記錄值。

## 測試矩陣

| 測試 | 預期 |
| --- | --- |
| Valid active QR | 建立一個短效 session |
| Invalid／expired／paused／revoked QR | generic 4xx，不建立 session |
| Closed／sold-out／suspended stall | generic 4xx，不建立訂單 |
| Expired session | denied |
| Replayed consumed session | denied，寫入 security attempt |
| Invalid／expired／replayed／wrong-hostname／wrong-action Turnstile | denied |
| Duplicate idempotency key | 回傳原結果或 deterministic conflict，不重複建立 |
| Excess quantity／unique products／note | denied |
| Invalid／sold-out product or modifier | denied |
| Client price tampering | server price wins／request denied |
| Cross-order tracking token | denied |
| Unsupported method／content type／oversize／invalid JSON | 4xx generic response |
| Rate-limit dimensions | IP、device、QR、session、stall、behavior 分別可觸發 429 |

Production 測試僅能使用 [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md) 建立的專用關閉測試攤位；未建立前只執行不產生訂單的負向測試。

## Log 驗收

- 檢查 Edge invocation、5xx、Turnstile failure、rate-limit、session replay、QR mismatch。
- `public_order_attempts` 應記錄 hash、reason code、request id，不記錄原始 IP、QR/session token、Turnstile token 或 pickup code。
- 任何 stack trace、database detail 或 secret 出現在 HTTP response 即阻擋部署。
- Staging 全部通過後才部署 Production；Production safe test 完成後再更新 Go-Live checklist。
