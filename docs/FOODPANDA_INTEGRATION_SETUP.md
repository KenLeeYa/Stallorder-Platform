# foodpanda 整合設定

## 目前狀態

`providers/foodpanda` 只有 Fail-closed Auth、Normalizer、Webhook 與 Adapter Scaffold。未使用未公開 Endpoint、未執行 Portal Scraping、未取得正式 Partner Approval。

## USER ACTION REQUIRED

1. 由 foodpanda/Delivery Hero 合作窗口確認台灣 Partner Integration Program。
2. 取得官方 Sandbox、Credential 型式、Webhook Signature、Store/Menu/Order API 與版本政策。
3. 確認是否支援 OAuth；若不支援，使用 Provider 核准的 Server Credential，不自行模擬 OAuth。
4. 登錄各環境唯一 Webhook URL。
5. Credential 只放受管 Secret Store，公開資料表僅保存 Reference。
6. 提供核准 Test Vendor/Store、Menu 與 Settlement Fixture。

## 預計 URL

```text
Webhook: <verified-origin>/api/webhooks/delivery/foodpanda
```

正式 Header、Signature 與 Event Schema 必須依核准文件實作，不能沿用 Mock HMAC。

## 啟用順序

Sandbox -> Ephemeral Preview -> Approved Production Canary -> 單一測試攤位 -> 小比例核准商家。未完成 Partner Review 前 Flag 必須維持關閉。
