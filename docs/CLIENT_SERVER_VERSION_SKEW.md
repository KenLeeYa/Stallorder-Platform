# 公開訂單用戶端與伺服器版本差異

## 協定

公開訂單核心請求使用：

```http
X-StallOrder-Protocol-Version: 1
```

套用範圍：

- `create-order-session`
- `create-public-order`
- `get-public-order`
- Circuit B 對應的三支 Next.js API

## 相容策略

目前伺服器接受：

- 未帶版本：保留已部署舊頁面的向下相容
- `1`：目前契約

其他值回傳：

```text
HTTP 426
code=CLIENT_VERSION_UNSUPPORTED
```

協定錯誤屬於用戶端／業務拒絕，不得觸發 A/B fallback。使用者會收到重新
整理頁面的安全訊息。

## 發布順序

1. 先部署可同時接受舊契約與新契約的伺服器。
2. 再部署帶版本 header 與穩定跨路徑識別碼的瀏覽器程式碼。
3. 觀察舊版請求比例與 426。
4. 確認舊資產生命週期結束後，另案決定是否停止接受缺少版本的請求。

不可在同一部署直接移除舊契約，否則仍在 CDN、Service Worker 或瀏覽器
分頁中的舊程式碼會失效。

## Service Worker

公開訂單 API、session、追蹤與付款資料維持 network-only，不得快取。
Service Worker 更新不得在尚有待同步交易時自動跳過等待或強制重新載入。

## 記錄限制

版本監控可記錄 route、協定版本、HTTP status、circuit 與 latency。不得
記錄 QR raw token、session token、Turnstile token、pickup code、顧客備註
或聯絡資料。
