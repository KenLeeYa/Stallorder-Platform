# 電子發票未來整合（停用）

## 現況

- `ElectronicInvoiceProvider` 定義開立、作廢、折讓、查詢與 webhook 驗證。
- `DisabledElectronicInvoiceProvider` 在正式路徑固定 fail closed。
- `MockElectronicInvoiceProvider` 只供測試。
- Admin 與 Merchant Invoice 頁只顯示「電子發票整合尚未啟用」，沒有開立按鈕。
- `E_INVOICE_ENABLED=false`，目前沒有外部 request 或 credential。

## 資料模型

- `tax_documents`：organization、Invoice、文件類型、最小化稅務欄位、雜湊載具值與狀態。
- `tax_document_events`：文件生命週期事件與 Provider event ID。
- `(invoice_id, organization_id)` 複合外鍵禁止跨租戶文件。
- 表為 FORCE RLS、service-only；載具原值不保存於此 scaffold。

## 未來實作要求

1. 與會計／法務確認 B2C／B2B、載具、捐贈、作廢、折讓與保存規則。
2. 對照 Provider sandbox 規格實作簽章、冪等、字軌與錯誤碼映射。
3. Tax ID、載具與買受人資料做欄位級最小化、遮罩、保存期限與存取稽核。
4. Invoice `PAID` 不應等同電子發票已成功開立；兩者為獨立狀態機。
5. 失敗重試須可恢復、不可重複開立，並有人工補正與告警。

啟用前須完成 sandbox、合規、secret rotation、資料保存、監控與 rollback 核准。

