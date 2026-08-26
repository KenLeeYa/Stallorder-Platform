# Customer 360 與成長治理

## 原則

- 商家操作員身分與顧客身分分離。
- 顧客資料以用途、同意版本、取得來源、撤回與留存期限治理。
- 優惠券兌換、點數與集點使用 append-only ledger 或 immutable record。
- 自動化具 dry-run、預算、frequency cap、idempotency 與停止條件。

## 本機狀態

優惠活動草稿與生命週期可測；Coupon issuance、行銷傳訊、RFM production job 仍受 `CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED` 硬鎖，不會因 Growth 模組開啟而繞過。
