# 多攤位 Realtime 與營運警示

## 原則

Realtime 只用來通知「資料可能改變」，PostgreSQL 才是 source of truth。寫入流程必須先完成交易，再由 trigger 建立 `operational_events`；Client 收到事件後重新抓取授權 API，不直接把 event payload 當完整訂單。

## Event schema

`operational_events`：

```text
id, organization_id, stall_id, event_type,
entity_type, entity_id, payload, created_at
```

目前 event type：

```text
ORDER_CREATED
ORDER_CONFIRMED
ORDER_PREPARING
ORDER_READY
ORDER_COMPLETED
ORDER_CANCELLED
PAYMENT_RECORDED
STALL_OPENED
STALL_PAUSED
STALL_CLOSED
PRODUCT_SOLD_OUT_CHANGED
```

Trigger 來源為 `order_events`、`payments`、`stalls` 與 `stall_products`。Scope trigger 會由 stall 驗證 organization，避免偽造跨 tenant event。

## 訂閱範圍

- 店員/廚房 channel 名稱：`stall:<stallId>`，Postgres filter：`stall_id=eq.<authorized-id>`。
- Owner/Admin Dashboard channel 名稱：`organization:<organizationId>`，filter：`organization_id=eq.<authorized-id>`。
- Channel 名稱只是 client 組織方式；真正授權來自 Realtime JWT + RLS。
- Payment event 只有財務或結帳相關角色可讀；Kitchen 不會收到。

`operational_events` 與 `operational_alerts` 已加入 `supabase_realtime` publication。新增事件表時必須同步 publication、RLS 與 pgTAP。

## 備援策略

員工看板：

- 優先 Supabase Realtime。
- 同時有授權 SSE `/api/stalls/:slug/orders/stream`；15 秒 heartbeat、50 秒重連週期。
- Realtime 與 SSE 都失敗時，每 5 秒輪詢。
- 無論連線狀態，每 30 秒 safety refresh；視窗重新可見時立即刷新。

組織 Dashboard：

- Realtime event/alert 後安靜刷新。
- 每 45 秒輪詢備援。
- 提供手動重新整理與連線狀態。

每次 SSE/輪詢仍由 session、role 與 stall scope 驗證，不因曾成功訂閱就跳過授權。

## Operational alerts

`refresh_operational_alerts(organization_id)` 以 advisory transaction lock 防止同組織重複刷新。目前自動產生/解除：

- `ORDERING_PAUSED`
- `EXCESSIVE_PENDING_ORDERS`：10 筆以上 active orders
- `UNPAID_COMPLETED_ORDER`
- `HIGH_CANCELLATION_RATE`：24 小時至少 5 單且取消率 30% 以上

Schema 也保留 `PAYMENT_MISMATCH`、`STALL_OFFLINE`、`NO_RECENT_ACTIVITY` 供後續檢查工作使用。每個 stall + type 只能有一個 ACTIVE/ACKNOWLEDGED alert。

Dashboard 只替使用者有管理權的攤位刷新與確認警示。確認 alert 會寫 audit；條件消失時刷新函式改為 RESOLVED。

## 監控

- Realtime channel error/timed out/closed 比率。
- SSE reconnect、fallback 啟用時間與 API P95。
- event 建立到 UI authoritative refresh 的延遲。
- 同一事件重複 UI 更新不得造成訂單重複或狀態倒退。
- publication、RLS 變更與 Supabase Realtime 配額。

事件保留/分割需依實際量決定；Phase 1 不加入額外 queue 或組織 summary table。
