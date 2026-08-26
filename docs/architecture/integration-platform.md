# 整合平台

## 元件

- Integration Setup Center：顯示設定與驗證狀態。
- Provider Adapter：把外部資料正規化，不讓 Provider schema 滲入訂單核心。
- Outbox/Inbox：非同步投遞、防重、retry、DLQ 與 replay。
- Public API：scope、stall allowlist、expiry、rate limit、audit。
- Webhook：HMAC timestamp/payload、secret rotation、delivery receipt。

## 就緒層級

`NOT_CONFIGURED → CONFIGURED → VALIDATING → SANDBOX_READY → PILOT_READY → PRODUCTION_READY`

`架構已完成`不等於任何一個環境就緒層級。沒有可重現的 Provider 證據時一律保守顯示。
