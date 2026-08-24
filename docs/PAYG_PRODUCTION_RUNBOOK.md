# PAYG Production Runbook

## 啟用順序

1. 套用 migration，執行全部 database／unit／build Gate。
2. 取得稅務、cap basis、捨入與文件需求的書面核准。
3. 由平台管理員建立並封存新 PAYG 版本，核對 hash 與 entitlements。
4. Staging 執行遷移 preview、人工遷移、期間 preview、人工關帳及晚到退款。
5. 執行 read-only Production audit；結果不得為 `NOT_READY`。
6. 小量依序開啟 PAYG core、refund credits、遷移 flag；第一期保持人工關帳。
7. 觀察 reconciliation 後才開 automatic close；商家帳務顯示最後開啟。

## 事件處理

出現 hash、稅務、重複事件、帳單算術或 scheduler stale：立即關閉自動關帳與收費 flags，保留資料，匯出 audit 與 request ID。修正只可使用 forward migration／append-only adjustment，不修改已套用 migration 或歷史 ledger。
