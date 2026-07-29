# 離線 POS 架構

## 階段狀態

- 實作階段：P4 Offline PWA foundation
- 預設狀態：關閉
- 寫入模式：`SINGLE_DEVICE_ONLY`
- 每攤位離線寫入裝置：最多一台 `OFFLINE_LEADER`
- P4 尚未開放：離線建立訂單、現金收款、列印、同步與衝突處理

目前只提供裝置登錄、管理者核准、短效 Permit、不可變菜單快照、
IndexedDB 基礎與 Service Worker 更新閘門。P5 完成前，任何斷線狀態都不會
顯示訂單已成立。

## 拓樸

```text
攤位管理者
-> /merchant/stalls/:stallId/offline
-> 核准裝置並指定唯一 Offline Leader

店員裝置（在線且已登入）
-> POST /api/stalls/:stallSlug/offline/devices
-> POST /api/stalls/:stallSlug/offline/bootstrap
-> 瀏覽器儲存能力檢查
-> 裝置綁定 Permit + 菜單快照
-> IndexedDB 原子寫入
```

其他已核准裝置為 `OFFLINE_READ_ONLY`。P4 不實作裝置間共識、WebRTC 或
本地多主寫入。

## 啟用閘門

同時符合以下條件才會發行 Permit：

1. `OFFLINE_POS_ENABLED` 已針對目標範圍開啟。
2. `OFFLINE_SINGLE_DEVICE_ONLY` 維持開啟。
3. 使用者具備攤位 `CREATE_ORDERS` 權限。
4. 裝置為 `ACTIVE`、`offline_enabled=true` 且角色為 `OFFLINE_LEADER`。
5. 攤位政策為 `SINGLE_DEVICE_ONLY`，並指向相同裝置。
6. Primary 為目前可寫入後端。
7. 瀏覽器儲存能力不是 `INSUFFICIENT` 或 `UNAVAILABLE`。
8. `OFFLINE_PERMIT_SIGNING_SECRET` 已設定為獨立高強度密鑰。
9. 不可變公開菜單快照已發布至物件儲存。

`OFFLINE_MANUAL_PAYMENT_ENABLED` 預設關閉。即使開啟，也只允許 P5 實作的
現金或人工付款；LINE Pay、街口支付與信用卡授權永遠不能離線進行。

## Service Worker

Cache-first：

- 版本化 JS/CSS
- 圖示
- `/offline`
- 非敏感應用程式殼層

Stale-while-revalidate：

- 商品圖片
- 公開菜單 API
- 版本化公開離線菜單快照

Network-only：

- 登入、Session、CSRF
- 訂單與付款寫入
- 帳務、稽核與顧客資料
- 取餐碼

Service Worker 不快取已驗證 HTML。偵測到待同步訂單或佇列時，不會強制
接管新版 Worker，也不會刪除舊快取；使用者必須先完成同步或通過相容性
遷移。

## 菜單快照

授權裝置取得的完整店員快照直接寫入 IndexedDB。公開 CDN 版本另行過濾：

- 僅包含啟用的分類、群組、商品、註記群組與註記選項
- 可保留售罄狀態，以避免顯示錯誤可售資訊
- 不包含顧客、Session、Permit、付款憑證、供應商密鑰或稽核資料
- 路徑包含 organization、stall、版本與內容 SHA-256
- 回應使用一年 `immutable` 快取

公開快照由 Primary Storage 儲存，並透過既有 manifest/outbox 複寫至 DR。
讀取路由會依 active backend 順序嘗試 Primary 與 DR。

## 漸進啟用

1. 保持全域預設關閉。
2. 只在隔離 Staging 的單一測試攤位開啟。
3. 登錄一台測試裝置並由管理者指定為 Leader。
4. 驗證 Permit、公開快照、IndexedDB 與更新閘門。
5. P5 完成並通過離線訂單 E2E 前，不開放真實商家離線寫入。

## 回復

先關閉攤位的離線政策，再關閉 `OFFLINE_POS_ENABLED`。政策停用會撤銷目前
有效 Permit、移除 Leader 角色並保留裝置與稽核歷史。不要清除瀏覽器
IndexedDB，因為 P5 後可能包含尚未同步資料。
