# 訂閱狀態機

## 狀態轉換

```text
TRIALING -> ACTIVE | SUSPENDED
ACTIVE -> PAST_DUE | SUSPENDED | CANCELLED
PAST_DUE -> ACTIVE | GRACE_PERIOD | SUSPENDED
GRACE_PERIOD -> ACTIVE | SUSPENDED
SUSPENDED -> ACTIVE | CANCELLED
```

- `TRIALING -> ACTIVE`：已驗證付款使 Invoice 完整付清。
- `TRIALING -> SUSPENDED`：試用到期且未完成付款。
- `ACTIVE -> PAST_DUE`：付款期限已過。
- `PAST_DUE -> GRACE_PERIOD`：進入受控寬限期。
- 任一允許狀態到 `SUSPENDED`：Platform Admin 提供原因並執行受稽核操作。
- `SUSPENDED -> ACTIVE`：付款或人工核准後恢復。
- `CANCELLED` 為受控終止，不自動刪除歷史資料。

## 交易規則

- 所有轉換使用 `BillingWorkflowService.transitionSubscription`。
- 服務鎖定 Subscription，驗證合法來源狀態，再更新時間欄位、organization 狀態、audit 與 notification。
- 付款啟用同時鎖定 Manual Payment、Invoice 與 Subscription。
- request ID、actor、before/after 必須完整；不接受客戶端提供 actor 或 organization scope。

## 存取影響

| 狀態 | 新公開訂單 | 商家登入／歷史 | 帳務頁 |
| --- | --- | --- | --- |
| `TRIALING` | 可，受日期與 100 筆限制 | 可 | 可 |
| `ACTIVE` | 可，付費額度為軟限制 | 可 | 可 |
| `PAST_DUE` | 依受控寬限策略 | 可 | 可 |
| `GRACE_PERIOD` | 依受控寬限策略 | 可 | 可 |
| `SUSPENDED` | 不可建立新 session／order | 可 | 可 |
| `CANCELLED` | 不可 | 可依保存政策唯讀 | 可 |

## 自動化狀態

Phase 1 不啟用自動催收、自動續約或外部付款 retry。任何未來排程都必須冪等、由 feature flag 控制，且不得與 pg_cron／Vercel Cron 重複。

