# 離線同步協定

## 語意

StallOrder 使用「至少一次傳遞 + 伺服器冪等匯入」，不宣稱網路層 exactly-once。
每個本機 entity、queue、idempotency key 與裝置離線訂單 ID 均為 UUID。

```text
恢復連線
-> GET /api/availability/config
-> 取得單一跨分頁同步鎖
-> 讀取 10 至 50 筆本機佇列
-> 標記 PROCESSING 與 lease
-> POST /api/offline/sync
-> 逐筆套用 receipt/conflict
-> 清除已到保存期限的 payload
```

前景載入、`online` 事件、頁面恢復可見、30 秒輪詢、Service Worker 訊息與
Background Sync 都可觸發相同 coordinator。多分頁優先使用
`navigator.locks`，無支援時改用 IndexedDB lease 與 BroadcastChannel。

## API

### `POST /api/offline/bootstrap`

需要有效 Session、`CREATE_ORDERS`、CSRF、stall scope 及管理者已核准的
Leader 裝置。回應包含短效 Permit、裝置設定、菜單快照及現金班別快照，
並使用 `private, no-store`。

### `POST /api/offline/sync`

最大 body 512 KB，每批 1 至 50 筆。請求包含：

- `installationId`
- `permitToken`
- `appProtocolVersion`
- `clientSentAt`
- `records`

API 對 profile+installation 與 IP 分別套用 rate limit。Permit 原文不寫入
資料庫、日誌或回條。

### `GET /api/offline/sync-status`

需要有效 Session、`VIEW_ORDERS` 與相同 stall scope，只回傳該裝置的佇列、
衝突與最近同步摘要。

## Receipt

每筆回條包含：

- queue/local entity 識別
- `ACCEPTED`、`ACCEPTED_WITH_CONFLICT`、`DUPLICATE` 或 `REJECTED`
- canonical order ID／number
- server received time
- promotion epoch
- 衝突識別與處理狀態

`DUPLICATE` 代表伺服器找到同一 idempotency／device order 的既有 receipt。
Client 必須套用回條，不得再建立第二筆本機訂單。

## 重試

失敗記錄保留在 IndexedDB，以 2 秒至 5 分鐘的指數退避加 jitter 重試。
HTTP 401/403、裝置撤銷、Permit 到期或 protocol 不相容都不能繞過重新核准。
管理者或店員可使用「立即同步」手動重試。

## 資料保留

- 未同步資料：保存到成功同步或人工處理
- 同步後完整 payload：7 天
- 本機 receipt：30 天
- conflict：處理前不刪除

Service Worker 更新不得清除尚未同步資料。

## Promotion epoch

Permit 與每筆本機交易都保存建立當下的 `promotion_epoch`。同步到不同 epoch 時，
伺服器不會直接拒絕所有合法離線交易，而會先查：

1. `domain_inbox` message key；
2. device order ID；
3. idempotency key；
4. 既有 sync receipt。

沒有 canonical duplicate 時才匯入，並建立 `BACKEND_EPOCH_CHANGED` 衝突標記供
管理者檢視。舊 Primary 與新 DR 都使用同一套伺服器驗證、價格快照、Permit
時間範圍與 stall scope；epoch 變更不會繞過任何控制。
