# Supabase Security Advisor Hardening

驗證日期：2026-07-24

## 調整範圍

- 將 16 個 RLS 授權 helper 從 Data API 暴露的 `public` schema 移到
  `app_private`。
- helper 保留 `SECURITY DEFINER` 與空白 `search_path`，避免 membership
  policy 產生遞迴查詢。
- `authenticated` 只有解析及執行 RLS helper 所需的最小權限；`anon`
  沒有 `app_private` schema 使用權。
- `effective_stall_product_price` 與 `stall_business_date` 保留
  `public` 相容入口，但改成 `SECURITY INVOKER`，且呼叫私有實作前會驗證
  stall 存取權。
- `merchant_applications` 與 `merchant_application_notifications` 各自的
  applicant/admin permissive SELECT policy 合併成單一等價 OR policy。
- `public` schema 未來新增的函式不再自動授權 Data API roles 執行，必須
  在 migration 中明確 `GRANT EXECUTE`。

## Server-only 表

部分 exposed tables 刻意採用以下組合：

- RLS enabled and forced
- 不授權 `anon` 或 `authenticated`
- 不建立 client policy
- 僅由受信任 server/database role 存取

這類表在 Advisor 會出現 `rls_enabled_no_policy` 的 INFO 訊息。這是封閉式
設計，不應為了清除 INFO 而新增 permissive policy。

## 洩漏密碼保護

Hosted Auth 設定使用 Management API 欄位：

```json
{
  "password_hibp_enabled": true
}
```

Supabase 僅在 Pro 以上方案提供此功能。Free 方案會回覆 HTTP 402，因此
不得將 API 拒絕誤記為已啟用。方案升級後，應依序在 Staging、Production
啟用，並重新讀取 Auth config 與 Security Advisor 驗證。

StallOrder 的既有自訂 `profiles.password_hash` 登入不屬於 Supabase Auth
密碼流程；Supabase HIBP 設定不會回溯檢查或取代該自訂驗證。

## 驗證

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npx supabase db reset --local
npx supabase test db --local supabase/tests/database
npx supabase db lint --local --level warning
npm run build
npm audit --audit-level=moderate
```

部署後另外確認：

- exposed schema 中可由 `authenticated` 執行的授權 `SECURITY DEFINER`
  helper 數量為 0。
- `merchant_applications` authenticated SELECT policy 數量為 1。
- `merchant_application_notifications` authenticated SELECT policy 數量為 1。
- `anon` 無法解析 `app_private`。
- 私有 cron/job processor 仍不可由 `authenticated` 執行。

## 回滾

此 migration 不刪除資料，也不改變資料欄位。若部署後出現權限回歸：

1. 暫停後續 schema 寫入並保留失敗 request ID。
2. 以新的 forward-fix migration 回復，不刪除已套用 migration history。
3. 先移除兩個 `public` invoker 相容入口，再將 16 個 helper 移回
   `public`。
4. 使用原 migration 定義把 helper 內部呼叫改回 `public.*`，並恢復原
   ACL。
5. 移除兩條合併 policy，恢復原本 applicant 與 platform-admin 四條
   policy。
6. 重跑完整 pgTAP、Advisor 與登入/商家申請 smoke test 後再解除暫停。

Staging 曾有同內容、不同時間戳的 migration history。校正前必須逐一比對
remote `statements` 與 Git migration 的正規化 SHA-256；只有完全一致時才
能使用 `supabase migration repair`。回滾 history 校正時，將相同映射的
`applied` 與 `reverted` 狀態反向操作，schema 本身不重跑。
