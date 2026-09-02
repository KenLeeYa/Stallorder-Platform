# 目前狀態稽核

稽核日期：2026-08-30。結論上限：`LOCAL_MOCK_READY`。

| 項目 | 狀態 | Evidence | Action |
|---|---|---|---|
| 既有 `Invoice` | Existing | Prisma 內為平台訂閱帳單 | 保留，不挪作店家訂單發票 |
| 既有 `TaxDocument` | Existing | Prisma 內為平台商業計費稅務文件 | 保留，不與本模組合併 |
| 訂單／付款 | Existing | `Order`、`Payment` 已由伺服器管理 | 僅以 composite FK 關聯，不改寫付款結果 |
| 支付整合模式 | Reusable | provider-neutral payment service 與 setup center | 重用 RBAC、audit、feature flag 與 fail-closed 慣例 |
| 店家電子發票 domain | Added | `InvoiceDocument` 等七個新模型 | 本機 migration 與 pgTAP 驗證 |
| Provider adapter | Partial | 介面、Mock、contract-only adapters | 真實契約測試前維持 BLOCKED |
| 顧客結帳 UI | Partial | Circuit B session 與 post-order preference API | Production/Edge 路徑在 flag 關閉時維持不可用 |
| Retry/DLQ | Partial | operation ledger、分類、排程時間與 dead-letter 狀態 | 尚無安全重建請求的背景 worker |
| Reconciliation | Added | Mock remote state 比對與人工案件 | 真實 Provider 對帳需 Sandbox contract |
| Webhook | Missing by design | 無已驗證簽章契約 | 不建立猜測 endpoint；日後逐 Provider 實作 |

## 不重複實作的界線

平台訂閱 `Invoice`/`TaxDocument` 繼續處理 StallOrder 對商家的計費；新 `InvoiceDocument` 只處理商家對顧客的訂單發票。兩者不可互相回填或共用法律編號。
