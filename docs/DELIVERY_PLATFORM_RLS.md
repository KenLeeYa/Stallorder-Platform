# 外送平台 RLS

## 表格

以下表格全部啟用 `ENABLE ROW LEVEL SECURITY` 與 `FORCE ROW LEVEL SECURITY`：

- `delivery_platform_connections`
- `delivery_platform_connection_requests`
- `external_store_mappings`
- `external_menu_mappings`
- `external_orders`
- `delivery_webhook_events`
- `delivery_sync_jobs`

## 權限模型

- `anon`：無任何 Table Grant。
- `authenticated`：僅可依既有 Organization/Stall Membership 讀取必要管理資料。
- `authenticated`：不可直接寫入 Connection、Mapping、External Order、Webhook Ledger 或 Job Queue。
- `authenticated`：不可讀取 Webhook Security Evidence 與 Job Input。
- `service_role`：供受信任後端執行；仍受 Primary Writer Guard。
- `KITCHEN`：只能經既有 KDS Projection 看外送營運欄位，不能讀 Provider Credential、付款拆分或管理設定。

## Scope

Policy 重用 `has_organization_role()` 與 `has_stall_role()`。API 另執行 Session、Permission、Entitlement 與 Object Ownership 檢查，RLS 為第二層防線，不以 Client 傳入的 `organization_id` 作為授權依據。

## 驗證

`supabase/tests/database/delivery_platform_foundation.test.sql` 驗證：

- 七張表 RLS/FORCE RLS。
- `anon` 無 Grant。
- `authenticated` 無直接寫入與 Queue/Webhook 讀取。
- Owner 僅看授權組織。
- 偽造 Organization Filter 不可越權。
- Kitchen 不可讀連線設定。
- Primary Writer Trigger 覆蓋全部 Writer Table。
