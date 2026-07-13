# 多攤位資料庫 Schema

## 核心實體

| 實體 | 主要欄位與用途 |
| --- | --- |
| `organizations` | tenant、商務狀態、預設時區/幣別 |
| `stalls` | `organization_id`、slug/code、營運狀態、點餐開關、時區/幣別 |
| `profiles` | Supabase Auth 對應、Email、顯示名稱、啟用狀態；不固定綁定 tenant |
| `organization_memberships` | profile 在組織的角色、`all_stalls`、啟用狀態 |
| `stall_memberships` | profile 在指定組織/攤位的角色與啟用狀態 |

主要唯一性：

- `organizations.slug`、`organizations.email`
- `stalls.slug`
- `stalls (organization_id, code)`
- `profiles.auth_user_id`、`profiles.email`
- `organization_memberships (organization_id, profile_id, role)`
- `stall_memberships (stall_id, profile_id, role)`

Trigger 會由 parent stall/order/product 推導 scope，拒絕 `organization_id` 與 `stall_id` 不一致的寫入。

## 商品

```text
product_categories (organization_id)
  └─ product_groups (organization_id, category_id)
       └─ products (organization_id, category_id, group_id, default_price)
            └─ stall_products
               (organization_id, stall_id, product_id,
                price_override, is_enabled, is_sold_out, sort_order)
```

`stall_products (stall_id, product_id)` 唯一。Master 與 assignment 都以停用取代硬刪除；`order_items` 保存 `name`、`unit_price`、`quantity` 快照。

## QR 與訂單

| 表 | Scope | 重點 |
| --- | --- | --- |
| `qr_codes` | organization + stall | state、token version、到期；可撤銷/輪替 |
| `order_sessions` | organization + stall | token hash、QR、IP/device hash、到期、消耗/撤銷 |
| `orders` | organization + stall | 狀態、付款、冪等鍵、tracking/pickup hash、確認期限 |
| `order_items` | organization + stall | 歷史商品快照 |
| `order_events` | organization + stall | 狀態與結帳事件歷程 |
| `payments` | organization + stall | CASH/MANUAL_TRANSFER/OTHER、金額、記錄者 |
| `public_order_attempts` | nullable scope | 防濫用允許/拒絕事件，只保存各維度 hash |
| `public_rate_limit_buckets` | organization + stall | IP/device/QR/session/stall/behavior 時間窗 |

訂單約束包括 `(stall_id, order_no)` 與 `(stall_id, idempotency_key)` 唯一。公開 session token、tracking token、pickup code、邀請 token 與應用 session token都不保存原文。

## 報表與營運

- `daily_stall_summaries`：`(stall_id, business_date)` 唯一，包含訂單、完成、取消、待處理、未付款、銷售與付款方式。
- `operational_events`：資料提交後產生的訂單/付款/攤位/售罄事件。
- `operational_alerts`：每攤每類只允許一個 ACTIVE/ACKNOWLEDGED open alert。
- `audit_logs`：organization/stall、actor、action、before/after JSON、request ID、outcome。

`rebuild_daily_stall_summary(stall_id, from, to)` 最長重建 367 天，使用該攤位 timezone 將 `created_at` 映射至營業日。訂單與付款 trigger 會即時重建受影響日期。

## 商務與邀請

| 表 | 用途 |
| --- | --- |
| `plans` | 方案價格、included/max stalls、超額單價 |
| `subscriptions` | 組織目前方案、狀態、帳期 |
| `additional_stall_approvals` | 平台管理員人工核准額外攤位與 unit price |
| `invoices` | 組織帳期、subtotal/total/status |
| `invoice_line_items` | base/additional/usage/add-on 明細 |
| `usage_events` | 訂單、攤位、成員、QR、CSV 的可去重計量 |
| `organization_invitations` | Email、角色、可選 stall、token hash、到期/接受/撤銷 |

Usage 以 `(organization_id, event_type, reference_id)` 的 partial unique index 去重；member 事件記錄增減量，彙總時不得跨 membership 表重複計算。

## 索引策略

已覆蓋主要查詢：

- organization/status、stall/status/created_at
- membership profile/organization/stall/role/is_active
- business_date、order/payment status、created/completed time
- product/category/group/assignment
- operational event/alert 的 organization/stall + desc timestamp
- subscription/invoice/usage 的 organization + period/type
- invitation token/status/expiry

儀表板查詢 daily summary；Realtime 只訂閱已篩選事件；公開商品查詢限制 100 筆，API 日期與清單皆有上限。

## RLS 覆蓋

目前 public schema 共有 32 張業務表 `ENABLE ROW LEVEL SECURITY` 並 `FORCE ROW LEVEL SECURITY`：

```text
additional_stall_approvals, audit_logs, auth_sessions,
daily_stall_summaries, invoice_line_items, invoices,
operational_alerts, operational_events, order_events, order_items,
order_sessions, orders, organization_invitations,
organization_memberships, organizations, payments, plans,
product_categories, product_groups, products, profiles,
public_order_attempts, public_rate_limit_buckets, qr_codes,
rate_limit_buckets, stall_memberships, stall_order_counters,
stall_ordering_settings, stall_products, stalls, subscriptions,
usage_events
```

`anon` 沒有業務表寫入權限；authenticated 僅取得政策允許的 select；受信任 Next.js/Edge 透過伺服器連線或 service role 寫入。

## 相容與分階段限制

- 舊 `tenants`、`user_accounts` 以受限 compatibility view 保留，待所有 production job 完成切換後再移除。
- 相容期的 `tenant_id/user_id` 由 trigger 與新欄位保持一致。
- 現有系統沒有 modifier tables，因此本版本不建立虛構 modifier 資料；後續應以獨立 migration 建立 organization master + per-stall assignment。
