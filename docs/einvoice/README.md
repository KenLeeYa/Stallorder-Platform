# 多租戶電子發票（本機 Mock）

目前可驗證層級為 `LOCAL_MOCK_READY`。本模組讓每個商家以自己的賣方身分與 Provider 帳號管理訂單電子發票；StallOrder 平台不是店家的賣方，也不共用店家憑證。

## 已完成範圍

- Provider-neutral domain：ECPAY、EZPAY、TRADEVAN、CUSTOM（CUSTOM 預設停用）。
- 賣方資料、Provider connection、能力快照、不可變政策版本。
- 訂單發票文件、操作帳本、retry/DLQ 狀態與人工對帳案件。
- 本機 Mock 的開立、查詢、作廢、折讓、作廢折讓、載具／捐贈碼驗證與對帳。
- 顧客結帳發票選項、商家設定／歷史頁及平台唯讀監控頁。
- 租戶隔離、RLS、敏感欄位加密／遮罩與明確 `TEST / NOT A LEGAL INVOICE` 標示。

## 強制邊界

- `EINVOICE_PRODUCTION_ISSUE_ENABLED=false`，Production 開票預設且目前強制關閉。
- 真實 Provider adapter 全部 fail-closed；沒有正式憑證、Sandbox、Pilot 或 Production 證據。
- 本機文件不是合法電子發票，不得交付顧客、報稅或取代財政部資料。
- 訂單、付款與發票狀態彼此獨立；發票失敗不會取消訂單或自動退款。

導覽：先讀 [目前狀態稽核](CURRENT_STATE_AUDIT.md)、[架構](ARCHITECTURE.md)、[安全模型](SECURITY_MODEL.md)、[測試計畫](TEST_PLAN.md) 與 [實作報告](IMPLEMENTATION_REPORT.md)。
