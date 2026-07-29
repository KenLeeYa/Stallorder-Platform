# Uber Eats 整合設定

## 目前狀態

`providers/uber-eats` 只有 Fail-closed OAuth、Normalizer、Webhook 與 Adapter Scaffold。未呼叫正式 Eats API，未取得 Partner Approval，不可開啟正式流量。

## USER ACTION REQUIRED

1. 申請 Uber Eats Partner/API Access 與台灣適用權限。
2. 取得官方 Sandbox、Scope、OAuth Endpoint、JWKS/Signature、Webhook Event 與 API 版本文件。
3. 在 Uber Console 登錄各環境唯一 Callback/Webhook URL。
4. 將 Client Secret/Token 放入受管 Secret Store，只在正式 Provider Runtime 以 Reference 取用。
5. 提供核准的 Test Store、Menu 與 Settlement Fixture。
6. 完成 Uber 要求的 Security/Privacy Review。

## 預計 URL

實際 URL 必須以部署後的受驗證網域為準，不可猜測：

```text
OAuth callback: <verified-origin>/api/merchant/integrations/delivery/uber-eats/callback
Webhook:        <verified-origin>/api/webhooks/delivery/uber-eats
```

目前 Callback Route 尚未對正式 Uber 開放；取得官方契約後另行實作及測試。

## 啟用順序

Sandbox -> Ephemeral Preview -> Approved Production Canary -> 單一測試攤位 -> 小比例核准商家。每一步需保留回復與稽核證據。
