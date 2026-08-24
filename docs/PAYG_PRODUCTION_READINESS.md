# PAYG Production Readiness

執行 `npm run billing:payg:production-audit` 產生 JSON 與 Markdown 唯讀報告。報告檢查 schema、RLS、契約、Subscription snapshot、ledger 重複、summary 算術、Invoice snapshot／稅額、未套用折抵、scheduler 與 rollout flags。

任何下列項目一律 `NOT_READY`：稅務未設定、contract hash 不一致、重複 ledger、Invoice 算術錯誤、PAYG Subscription 使用未封存版本、migration／constraint／RLS 缺失。

本機通過不等於 Staging 或 Production。正式啟用還需要：會計／稅務簽核、Staging manual pilot、原 Invoice 稅務與 late-credit 驗收、cron stale／failure 告警、備份與 DR reconciliation、實際 Production audit receipt。
