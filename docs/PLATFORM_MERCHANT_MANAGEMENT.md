# 平台商家管理

## 申請階段

- `/admin/merchant-applications`：人工審核 queue、風險、重複資料、reviewer 與等待時間。
- `/admin/merchant-applications/:id`：補件、拒絕、重申請、風險、封鎖與原子核准。

## 核准後

- `/admin/billing` 與既有 subscriptions／invoices／payments／usage／plans 頁面管理商用狀態。
- Application 明細顯示 approved Organization、Trial、setup 測試與 Go-live 結果。
- Organization 是正式商用範圍；額外 Stall 由既有 approval／subscription item 管理。

## 職責分離

- Platform Admin 核准申請與驗證人工付款，但不能替商家執行 setup Go-live。
- Organization Owner 完成設定、測試單及明確開放接單。
- Finance Viewer 只讀帳務；Staff／Kitchen 無 application review 或 billing 權限。

所有審核、方案、Invoice、付款、停權、恢復與 usage rebuild 操作需寫 Audit Log。人工帳務操作見 [MANUAL_BILLING_OPERATIONS.md](MANUAL_BILLING_OPERATIONS.md)。
