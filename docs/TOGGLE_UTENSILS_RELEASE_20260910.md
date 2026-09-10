# 按鈕式開關、餐具列印與版面修正發布

日期：2026-09-10。狀態：發布候選，正式完成以本次 immutable Plan／Apply 與 live smoke 為準。

## 範圍與來源

- 正式基準：`8acb4b98f0ebe43fcbaf5cc9fe40071c5c5b6abd`；Staging 基準：`ff3addc0d8e433ecd79ab15f04764b18a04b143e`。整合前兩者 tree 相同。
- 原始本機分支：`codex/toggle-utensils-20260909`，提交 `047fe02`、`3da0440`、`9e9efba`。
- 從最新 Staging 建立 `codex/release-toggle-utensils-20260910`，依序取入上述三個提交；加入本文件前的完整 tree 與原始本機分支相同。
- 全域按鈕式開關、顧客／店員多選樣式、餐具需求獨立列印、員工排休表單與相關欄位縮排，以及店員品項開關不遮擋資訊。
- 同步本機測試服務生命週期文件；這些文件不啟動或停止任何正式服務。
- 保留另外獨立的整體介面改版；不合入供應鏈或其他未納入本次對話的工作分支。

## 驗證與發布順序

詳見 [本機功能與 responsive QA](TOGGLE_CONTROLS_UTENSILS_QA_20260909.md)。使用 `X-009`、`PRN-010`、`QA-UI-11`、`QA-ORD-10`、`QA-PRN-06` 驗收規則。

1. 核對來源及差異，執行鎖檔安裝、lint、typecheck、UI audit、完整 unit、正式 build、依賴與密鑰掃描；重跑獨立 Chromium／WebKit 開關測試。
2. PR 至 Staging，等待同一 SHA 的 CI、來源安全掃描及配對 Supabase／Vercel Preview。CI 重建自己的拋棄式資料庫並執行 pgTAP、DB lint 與完整 E2E；不重設保留的本機資料。
3. Staging 合併後核對 CI／readiness，透過另一個 PR 將驗證過的相同 tree 提升至 main，並重跑該 PR 的檢查。
4. 本次沒有資料庫 migration、schema、Edge Function 或部署設定差異，使用 `Production Application Release` 的新 Plan，再使用同一 main SHA／tree 的 Apply。
5. Apply 建立尚未綁定網域的正式部署，通過 smoke 後才切換正式網域，再驗證正式 QR／健康檢查並保留 receipt；失敗依既有 workflow 回復 alias。

## 發布邊界

- 不匯入本機測試訂單、帳號或設定至 Production，不變更密鑰、資料庫／DR schema 或複寫範圍。
- 保持原有表單儲存、權限、選取、製作、付款與庫存行為。這次外觀切換不是新增自動儲存。
- 顧客已明確要求餐具時，新建立的廚房單與收據均列印需求，即使一般備註關閉。既有不可變列印 payload 不改寫，歷史空白偏好不推測。
- 紙張與實體印表機測試不等同於軟體列印內容測試；本次不宣稱取得新的實機列印證據。
- 本機測試服務按需啟動，結束後停止本次啟動的服務；其他工作使用的供應鏈環境依原先例外保留。

正式完成證據須記錄本次 PR、Staging／main SHA 與 tree、新 Plan／Apply ID、部署 URL 及正式 smoke 結果；不得使用上次發布 receipt 代替。
