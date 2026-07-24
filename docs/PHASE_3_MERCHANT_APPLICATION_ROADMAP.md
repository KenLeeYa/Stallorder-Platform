# Phase 3 商家申請路線圖

## 目標

支援 100+ 商家，以自助註冊、例外人工審核與自動付款驗證降低平台操作量。此文件只定義方向，不代表功能已啟用。

## 候選能力

- 版本化自動風險評分與 decision evidence。
- 自助 KYC／商業資料驗證及申訴流程。
- 經正式 provider webhook 驗證的付款自動化。
- 例外 queue、SLA、風險趨勢與決策品質監控。
- 多區域、資料保存與隱私刪除的法務／營運流程。

## 不變條件

- Enterprise、White Label 與大型多攤合約維持人工核准。
- Authentication、RBAC、commercial authorization 與 billing 維持分離。
- 任何自動核准仍只建立 PAUSED QR／CLOSED Stall。
- 測試訂單與 Owner 明確 Go-live 不可移除。
- 未完成法務、安全、sandbox 與 rollback gate 前，不啟用真實 payment／e-invoice provider。
