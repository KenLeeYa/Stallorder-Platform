# 外送平台合作夥伴需求

## 目前結論

Uber Eats 與 foodpanda 正式功能均未啟用。Repository 只有經型別檢查的 Fail-closed Adapter Scaffold，不使用未公開 API、不執行 Portal Scraping，也不收集商家平台密碼。

## 共同必要資料

- 官方 Partner Approval 與允許的市場/商家範圍。
- Sandbox 或 Test Store。
- 官方 OAuth/Token、Webhook Signature、Store/Menu/Order API 文件。
- Exact Callback/Webhook URL Allowlist。
- Scope、Token Rotation/Revocation、Rate Limit 與 Retry 規格。
- Provider 對 Idempotency、Ambiguous Response 與 Event Replay 的契約。
- Settlement/Discount/Fee/Tax 欄位定義。
- Data Retention、Privacy 與商務合約核准。

## StallOrder 不接受

- 商家帳號密碼。
- Browser Automation 或 Portal Scraping。
- 未經 Provider 文件確認的 Endpoint。
- 將正式 Credential 複製到 Local 或 Preview。
- 在正式商家流量上使用 Mock Adapter。

## 啟用閘門

Partner Approval、Security Review、Sandbox E2E、Ephemeral Preview、Production Synthetic Canary、Audit/Monitoring、Rollback 演練全部完成後，才可由平台管理員逐攤位開啟。
