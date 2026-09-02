# Reconciliation

對帳以本地 `InvoiceDocument` 與 Provider query 結果比較：外部文件編號、狀態、總額、稅額與折讓累計。

- 完全一致：文件標記 `MATCHED`，記錄成功 operation。
- 不一致、找不到或結果未知：標記 `RECONCILIATION_REQUIRED` 並建立 `InvoiceReconciliationCase`。
- 案件保存 case type、local snapshot、remote snapshot、review status 與 resolution note。
- 對帳不得自動修改訂單、付款或發票金額；必須由授權人員調查後結案。

目前 Mock 可驗證完整分支；真實 Provider 的批次查詢、日結檔、時區 cut-off 與 eventual consistency 規則尚待正式 contract。
