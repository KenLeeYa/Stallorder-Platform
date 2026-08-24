# PAYG Automatic Close

排程每小時呼叫受 `CRON_SECRET` 保護的 route；真正是否執行仍由 `PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED` 決定。啟用前必須同時滿足：Open Beta 已關閉、PAYG core 與 refund credits 已開啟、存在 hash 完整且稅務已設定的封存契約。

每份 Subscription 使用契約 snapshot 的 `invoice_close_delay_hours`。job key 為 `PAYG_CLOSE:{subscriptionId}:{billingPeriod}`；原子 claim、最多五次嘗試、單一商家失敗不阻斷批次。自動與人工關帳呼叫同一個 `PaygBillingService.closeBillingPeriod`，system actor 保持 null，不冒用人工管理員。

Kill switch：先關閉 automatic flag；若計價契約或稅務有疑慮，再依序關閉 refund credits、PAYG core 與 merchant billing visibility。不得刪除 job、ledger 或 Invoice。
