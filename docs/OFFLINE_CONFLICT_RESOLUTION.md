# 離線同步衝突處理

## 原則

衝突是已匯入資料的核對工作，不會被靜默丟棄。正式訂單保留 canonical number
與本機 `OFF-*` 編號；管理者於：

```text
/merchant/stalls/:stallId/offline
```

查看同 organization、同 stall 的衝突。

## 衝突類型

- 菜單／商品：`MENU_VERSION_EXPIRED`、`PRICE_CHANGED`、
  `PRODUCT_DISABLED`、`PRODUCT_DELETED`
- 權限／裝置：`ROLE_CHANGED`、`DEVICE_REVOKED`
- 訂單：`INVALID_STATE_TRANSITION`、`DUPLICATE_ORDER`、`CLOCK_SKEW`
- 後端切換：`BACKEND_EPOCH_CHANGED`
- 付款／現金：`PAYMENT_RECONCILIATION_REQUIRED`、`CASH_TOTAL_MISMATCH`、
  `SHIFT_ALREADY_CLOSED`、`DUPLICATE_CASH_MOVEMENT`、
  `MULTIPLE_OFFLINE_SHIFT`
- 列印／參照：`PRINT_STATUS_UNKNOWN`、`UNKNOWN_REFERENCE`

## 處理結果

- `AUTO_RESOLVED`：系統已用冪等資料完成
- `ACCEPTED_LOCAL`：核對後接受本機紀錄
- `MERGED`：人工與正式資料完成合併
- `REJECTED`：拒絕本機紀錄
- `CANCELLED`：取消衝突工作

管理者必須輸入至少 5 個字元的原因；拒絕或取消前另有確認。API 使用
Session、CSRF、`MANAGE_STALL`、stall scope、Zod 白名單與資料庫 advisory
lock，不能由前端直接修改 resolution。每次處理都寫入 audit log，並在同一
筆訂單沒有其他 OPEN conflict 時更新訂單衝突狀態。

## 核對順序

1. 先核對本機編號、正式訂單編號、裝置與時間。
2. 價格或商品衝突以顧客現場已確認的離線快照為交易依據，另行記錄差異。
3. 付款衝突先比對收款憑證與現金班別，不得把人工付款改成 provider 已授權。
4. `PRINT_STATUS_UNKNOWN` 先確認實體單據，避免重複出單。
5. `BACKEND_EPOCH_CHANGED` 先查 idempotency 與 failover receipt，再接受或合併。

禁止刪除 receipt、audit log 或原始 conflict 來「解決」問題。
