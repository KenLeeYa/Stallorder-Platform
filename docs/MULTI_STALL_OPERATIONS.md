# 多攤位部署與維運

## 部署前檢查

- Node.js 22+、鎖定的 npm lockfile、Supabase CLI。
- 正式 Supabase 開啟備份/PITR，先在 staging 還原正式備份副本演練 migration。
- 應用、Google OAuth、Turnstile 與 `PUBLIC_APP_ORIGINS` 使用完全一致的 HTTPS hostname。
- 核准方案底價、超額單價與 Enterprise entitlement，不沿用 0/NULL 種子收費。
- 執行完整測試計畫且 working tree 不含 `.env`、service key 或測試產物。

## Supabase 部署

```bash
supabase login
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push
supabase functions deploy create-order-session --no-verify-jwt
supabase functions deploy create-public-order --no-verify-jwt
supabase functions deploy get-public-order --no-verify-jwt
```

`verify_jwt=false` 只適用這三支公開函式；它們仍會做 CORS、bounded JSON、global/multi-dimensional gate、Turnstile/session/tracking 驗證。其他管理 API 不得仿照公開。

Edge secrets：

```text
ABUSE_HASH_SECRET
TOKEN_DERIVATION_SECRET
TURNSTILE_SECRET_KEY
TURNSTILE_EXPECTED_HOSTNAME
TURNSTILE_ALLOW_TEST_KEYS=false
APP_ENV=production
TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip
PUBLIC_APP_ORIGINS=https://app.example.com
```

Next.js secrets/config：

```text
DATABASE_URL
DIRECT_URL
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
NEXT_PUBLIC_TURNSTILE_SITE_KEY
AUDIT_IP_HASH_SECRET
TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip
ALLOW_DEMO_SEED=false
```

`TRUSTED_CLIENT_IP_HEADER` 只允許 `cf-connecting-ip` 或 `x-real-ip`。上游必須先移除客戶端同名標頭再寫入可信 IP；應用不接受 `X-Forwarded-For` 鏈。production 缺少此設定會 fail closed。

`ALLOW_DEMO_SEED=true` 仍只允許 loopback `DATABASE_URL`。正式環境不得設定此值，也不得執行 `npm run db:seed`。

## Google OAuth

1. 在 Google Cloud 建立 Web OAuth client。
2. Authorized redirect URI 設為 `https://<project-ref>.supabase.co/auth/v1/callback`。
3. 在 Supabase Auth Providers 啟用 Google，填入 client ID/secret。
4. Supabase URL Configuration 的 Site URL 設應用 HTTPS Origin。
5. Redirect allow list 加入 `https://app.example.com/auth/callback`，preview 網域使用明確 pattern。
6. Next.js 設定 Supabase URL/publishable key 與相同 `NEXT_PUBLIC_APP_URL`。
7. 以已被邀請的 Google Email 實測登入、callback、一次性邀請接受與 owner workspace。

參考：[Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)、[Server-side Auth](https://supabase.com/docs/guides/auth/server-side)、[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)。

## Migration 上線

依 [MULTI_STALL_MIGRATION_PLAN.md](MULTI_STALL_MIGRATION_PLAN.md) 先備份與比對 row count。Migration 套用後執行：

```bash
supabase db lint --linked
```

pgTAP 先以 `npm run db:test` 在本機或正式備份的隔離 staging clone 執行；production 只跑文件中的唯讀 validation queries。不得把自動測試清理流程指向 production，也不得手動改 production scope 欄位。

## 摘要對帳

先找出攤位與日期，再由受信任 service role 執行：

```sql
select public.rebuild_daily_stall_summary(
  '<stall-uuid>'::uuid,
  '2026-07-01'::date,
  '2026-07-07'::date
);
```

單次不超過 367 天。完成後比對完成訂單總額、付款方式、未付款與 Dashboard API。大量回補分攤時段執行並監控 database CPU/WAL。

## 營運警示處理

| 警示 | 初步處理 |
| --- | --- |
| Excessive pending | 確認現場連線/人力，必要時暫停該攤 QR |
| High cancellation | 檢查商品供應、誤觸取消與設備操作 |
| Unpaid completed | 對照現金/付款紀錄，修正流程後重建摘要 |
| Ordering paused | 確認是否預期；恢復前核對人力與庫存 |
| Realtime fallback | 驗證 RLS/JWT/publication，再觀察 SSE/輪詢 |

確認 alert 不代表問題已消失；只有刷新後條件不成立才改為 RESOLVED。

## 日誌與監控

- Next/Edge stdout 匯入集中式服務，以 request ID 關聯 `audit_logs/public_order_attempts`。
- 告警 Edge 5xx、CSRF/authorization/rate limit 異常、summary lag、Realtime fallback、DB CPU/連線/WAL/備份。
- 不記錄 raw QR/session/invitation/Turnstile token、密碼、完整 IP、取餐碼、顧客備註。
- 每季演練：QR 撤銷/輪替、關閉全攤、Turnstile fail-closed、secret rotation、PITR restore。

## Secret 輪替

- Turnstile/site keys：先新增新金鑰，部署 Edge/前端，再撤銷舊金鑰。
- Abuse/hash secrets：改變後既有 hash 不可比對；選低峰並接受 rate bucket 重新開始，保留 audit 記錄。
- QR token：使用商戶輪替控制；舊 QR 立即失效並保留 REVOKED 記錄。
- Supabase service key：依平台程序輪替，確認只存在 server/secret manager。

## 回復

Migration transaction 未提交時直接 rollback。已提交且沒有新寫入可用 PITR/完整備份回復；若已有新訂單，停止寫入、建立事故副本並以 forward-fix migration 修復，不能直接覆蓋新資料。回復後驗證 membership、orders/payments、QR、summary、invoice 與 audit。
