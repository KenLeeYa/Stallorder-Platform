# Phase 2 商家申請路線圖

## 目標

支援約 20～100 個商家，在保留人工覆核能力下，評估低風險自動核准。Phase 1 目前仍全部人工審核，`AUTOMATED_MERCHANT_APPROVAL_ENABLED=false`。

## 啟用前工作

- 手機驗證與重放防護。
- 可說明、可回溯的 risk decision 版本與閾值。
- verified Google identity、完整度、重複資料、IP/device rate、prior rejection 與 payment verification 訊號。
- 自動決策 shadow mode，至少一個營業週期只記錄、不執行。
- false-positive／false-negative、人工覆核比例、appeal 與 emergency disable 指標。
- RLS、CSRF、rate limit、audit、tenant isolation 與原子 provisioning 回歸。

## 保留人工審核

HIGH／BLOCKED、Enterprise、多攤大型合約、資料衝突或任何安全事件一律人工處理。自動核准不得直接 Go-live，仍須完成 setup、測試訂單與 Owner 明確開放。
