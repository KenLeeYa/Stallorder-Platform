# Uber Eats E2E Test Plan

## Local

測 HMAC 正確/錯誤、`X-Environment` mismatch、oversize/invalid JSON、unknown store、resource_href SSRF、duplicate event、ORDER_FETCH priority、fetch/store mismatch、canonical import、accept/deny、401 refresh、timeout/429 與 DLQ。

## Uber Sandbox

前提：Testing Developer App、test store、client secret、webhook secret、portal URL 與所需 scopes 完成。

1. 收到真實 notification 並於 durable persist 後回空 body 200。
2. 使用 `meta.resource_id` 抓完整訂單，驗證金額、items/modifiers、customer minimization。
3. 在期限內 accept 與 deny；驗證 portal/store 狀態。
4. 驗證 duplicate/retry、cancel event、API 401/429/timeout、worker retry/DLQ。
5. 只有 menu ownership 核准後測 sparse item suspension。

沒有 live Sandbox 原始證據時，Sandbox E2E 為 BLOCKED。
