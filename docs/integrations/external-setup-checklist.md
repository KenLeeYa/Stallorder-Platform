# 外部整合人工設定清單

本文件是外部設定的唯一人工清單；不得把值寫入 Git、截圖、issue 或 audit metadata。

## 共用前置

- [ ] 確認組織、攤位、環境與資料責任人。
- [ ] 在核准的 secret store 建立憑證；只保存 reference。
- [ ] 設定 redirect/callback/webhook allowlist 與最小 scope。
- [ ] 確認 sandbox 帳號、測試商店、測試付款與聯絡窗口。
- [ ] 設定 rate limit、timeout、retry、DLQ 與告警。
- [ ] 通過 contract、signature、replay、idempotency、redaction 測試。
- [ ] 完成 Pilot rollback 演練後才申請 Production Ready。

## LINE

- [ ] Channel ID/Secret、Messaging token、LIFF/redirect URI 分環境設定。
- [ ] Login 與 Official Account 憑證分離；驗證撤銷與 token rotation。

## 外送平台

- [ ] 取得 foodpanda/Uber Eats 合作與 API 核准。
- [ ] 對應 store/outlet、菜單版本、訂單 webhook 與狀態能力。
- [ ] 驗證簽章、重送、亂序、重複訂單與結算報表。

## 金流／發票

- [ ] Merchant ID、key、callback 與退款權限分環境設定。
- [ ] 驗證 authorize/capture/refund/reconcile 與 webhook replay。
- [ ] 電子發票驗證開立、作廢、折讓、補發及字軌／配號責任。

## Public API／Webhook

- [ ] Key scope 與 stall allowlist 經資料負責人核准。
- [ ] Webhook 只允許 HTTPS 443 公網目的地；確認固定 egress 與 DNS rebind 防護。
- [ ] Secret rotation、接收端 timestamp tolerance、retry/DLQ/replay 測試完成。

## 列印

- [ ] 用實際 iPad／瀏覽器、Star MCP31LB 或目標印表機完成 exactly-once 驗收。
