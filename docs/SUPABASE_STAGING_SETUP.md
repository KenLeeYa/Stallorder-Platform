# Supabase Staging 設定

目標名稱 `stallorder-staging`，Organization `KuanGuard`，區域 `ap-northeast-1`。

## USER ACTION REQUIRED

在建立專案前，明確同意已查詢的每月費用。Secret 值應直接輸入 Supabase／Vercel Secret 管理，不要貼入 Git、文件或聊天。

## 建立與健康檢查

1. 以 Supabase cost confirmation 建立專案；記錄 ref 為 `<STAGING_SUPABASE_PROJECT_REF>`。
2. 輪詢到 `ACTIVE_HEALTHY`，確認 Project URL、區域與 Organization 正確。
3. 取得 active publishable key 供 Preview browser 使用；不要將 secret/service-role key 放入 client variable。
4. 設定 Auth Site URL 為實際 Preview／staging URL，allow list 僅加入必要 `/auth/callback`。

## Migration

```powershell
npx supabase link --project-ref <STAGING_SUPABASE_PROJECT_REF>
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

- 套用前確認 remote history 為空或與本機完全相容；不得以 `--include-all` 掩蓋 drift。
- 不自動套 `supabase/seed.sql`。若需要 synthetic data，先逐項審查，再以受控 staging bootstrap 建立。
- 特別驗證 `20260713000400_product_categories.sql`：先搬移分類資料，再刪除舊 `products.category`。

## Edge secrets 與 Functions

設定 Staging 專用的 `ABUSE_HASH_SECRET`、`TOKEN_DERIVATION_SECRET`、`TURNSTILE_SECRET_KEY`、`TURNSTILE_EXPECTED_HOSTNAME`、`TURNSTILE_ALLOW_TEST_KEYS`、`PUBLIC_APP_ORIGINS`、`TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip`、`APP_ENV=staging`。只確認名稱存在，不輸出值。

部署並驗證：

```powershell
npx supabase functions deploy create-order-session --project-ref <STAGING_SUPABASE_PROJECT_REF> --no-verify-jwt
npx supabase functions deploy create-public-order --project-ref <STAGING_SUPABASE_PROJECT_REF> --no-verify-jwt
npx supabase functions deploy get-public-order --project-ref <STAGING_SUPABASE_PROJECT_REF> --no-verify-jwt
```

## Staging 驗收

- 執行全部 RLS／QR abuse 測試案例與 [PRODUCTION_EDGE_FUNCTION_VALIDATION.md](./PRODUCTION_EDGE_FUNCTION_VALIDATION.md)。
- 執行 Supabase Security Advisor 與 Performance Advisor；critical/high 必須修正。
- Review Database、Auth、Realtime、Edge Function logs，確認沒有 secret、token 或跨租戶資料外洩。
- Preview smoke test 通過後，才可開始 Production database 部署。
