# Supabase Staging 設定

既有專案 `StallOrder Project` 已轉作 Staging，Project ref `daeqwtpaxcebmtwxqdkj`，Organization `KuanGuard`，區域 `ap-northeast-1`。目標顯示名稱為 `stallorder-staging`。

## USER ACTION REQUIRED

- 在 Supabase Dashboard 將專案顯示名稱由 `StallOrder Project` 改為 `stallorder-staging`；名稱不影響 project ref 或部署隔離。
- 將 Staging 專用 Secret 值直接輸入 Supabase／Vercel Secret 管理，不要貼入 Git、文件或聊天。

## 建立與健康檢查

1. 專案已確認為 `ACTIVE_HEALTHY`，ref 為 `daeqwtpaxcebmtwxqdkj`。
2. Project URL、區域與 Organization 已確認正確。
3. 取得 active publishable key 供 Preview browser 使用；不要將 secret/service-role key 放入 client variable。
4. 設定 Auth Site URL 為實際 Preview／staging URL，allow list 僅加入必要 `/auth/callback`。

## Migration

```powershell
npx supabase link --project-ref daeqwtpaxcebmtwxqdkj
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

- 套用前確認 remote history 為空或與本機完全相容；不得以 `--include-all` 掩蓋 drift。
- 不自動套 `supabase/seed.sql`。若需要 synthetic data，先逐項審查，再以受控 staging bootstrap 建立。
- 特別驗證 `20260713000400_product_categories.sql`：先搬移分類資料，再刪除舊 `products.category`。
- 目前 27 份 migration 已套用，遠端版本與 Git timestamp 逐筆一致。
- 51 個 `public` 資料表全部啟用並強制 RLS；匿名角色不能直接寫入 `orders`。
- Security Advisor 的可修正警示已清除；保留 13 個 RLS 權限判斷函式警示作為必要例外。
- Performance Advisor 的未索引外鍵已由 43 個降為 0；空資料庫的 unused-index 資訊待實際流量後再評估。

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
