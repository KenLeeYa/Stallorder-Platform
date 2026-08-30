# Provider Adapter Contract

統一介面涵蓋：connection validation、capabilities、issue、query、void、allowance、allowance query/void、mobile barcode、donation code、reconcile 及 health check。

每次呼叫都必須包含：`organizationId`、`connectionId`、environment、correlation ID、document reference 與 idempotency key。結果使用一致的狀態、Provider request ID、外部文件編號、response code 與時間。

## 錯誤分類

- timeout / Provider 5xx：retryable，依 bounded exponential backoff 進 `RETRY_SCHEDULED`。
- Provider 4xx / unsupported capability：不可 retry，進 failure 或人工處理。
- idempotency key 若對應不同 payload：拒絕為 conflict。
- 未驗證的正式 Provider：固定回傳 contract blocker，不發網路請求。

## 官方證據與目前限制

- [ECPay 開發者文件](https://developers.ecpay.com.tw/) 與 [B2B 開立文件](https://developers.ecpay.com.tw/14850/) 可證明官方 stage/production host，但尚未完成商家契約、簽章、Sandbox fixture 與官方回應驗證。
- [ezPay 電子發票平台](https://inv.ezpay.com.tw/) 與 [API 下載頁](https://inv.ezpay.com.tw/Invoice_index/download) 只作為供應商存在與文件入口證據；本次未取得可機器驗證的完整契約。
- [TradeVan 電子發票服務](https://services.tradevan.com.tw/e-commerce/e-invoice/) 是產品證據，不是可安全實作的 API contract。

因此三個 live adapters 均維持 fail-closed；不得猜測路徑、欄位、簽章或 webhook 驗證方式。

