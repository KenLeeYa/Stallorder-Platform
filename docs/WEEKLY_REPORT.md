# QIDAIGO 每週改善項目

維護者從週報挑出可用原始證據重查的改善項目，用 GitHub Issue 串起 Codex 工作與驗收。程式庫是公開的。交接內容只填適合公開的技術摘要與連結，不放商家資料、訂單、憑證或私人對話內容。

## 匯入與去重

1. 依 [11 月 23 日範例](weekly-report/2026-11-23.json) 填寫 JSON。每項用固定的元件與問題識別碼 `key`，附具體 `revision`、公開 `evidence`、風險與驗收條件。維護者須先核對證據與適用版本，並搜尋舊名稱和同義詞。有負責該項目的 Issue 或 PR 時填 `tracking`，相關但範圍較大的 PR 可放進 evidence。
2. 已登入 GitHub CLI 的開發機可執行 `node scripts/weekly-report.mjs docs/weekly-report/2026-11-23.json`。這會讀取開啟和關閉的 Issue、PR，以及指定 PR 的 head、base、merge 和檢查連結。已合併 PR 的線上部署狀態要另外讀回。
3. 工作流進入預設分支後，維護者可在 Actions 手動執行 **Weekly report intake**，先選 `plan`，確認後用同一份 JSON 選 `apply`。每次最多 20 項。一次提交一批並等待結果，以免 GitHub 的 concurrency 取消較早的待執行批次。若中途失敗或被取消，重送整批即可重新比對。Issue writer 不持有程式碼寫入或部署權限。
4. 新問題開 Issue，相同證據重送略過，新證據附加留言。已關單、穩定鍵衝突、同標題或失效追蹤編號交給人工判斷。若週報改了標題和 key，維護者應指定原編號。查核程式保留人工描述及所有既有留言。

## Codex 與發布

維護者可在確認驗收條件後，對低風險 Issue 加上 `codex-ready`。執行 `node scripts/weekly-report.mjs queue` 可取得最早一件合格工作。首輪由一位操作者領取，標上 `codex-in-progress` 並回填 Codex 工作連結。Queue 只供讀取；多人同時開工前要先分配。Codex 由指定基底開分支，在草稿 PR 引用 Issue、記錄重現與測試。涉及付款、權限、通知、憑證或環境的項目用 `sensitive`，由維護者個別派工。

依[專案環境發布流程](ENVIRONMENT_RELEASE_WORKFLOW.md)核對相同候選版本的 CI、隔離 Preview 與整合後的 staging Git 版本。另行讀回受測後端身分，才能認定獨立 Staging 環境已驗收。缺少必要檢查、實際產品流程或環境身分時，Issue 記錄缺口。正式發布沿用既有受控 Plan／Apply。下期報告由 Issue 和 PR 讀回結果，只有實際服務網域、部署版本與受影響流程均有證據才記錄正式驗收完成。

## 本期處理順序

| 順序 | 領域 | 2026-11-23 核對與下一個驗收點 |
|---|---|---|
| 1 | 服務基底與取餐 | #411 的套件修補已由 #413 合入 staging；#412 追蹤元件在查核的 staging 上內容相同。保留既有 PR，核對服務版本與實際取餐回歸。#419 由既有發布工作負責。 |
| 2 | LINE 候選版本 | #365、#366 各自鎖定 LIFF 2.31.0；兩個候選基底分別驗證 SDK 與 Flex 卡片。測試 Channel 仍須驗 LINE 登入返回、商家切換及深層連結。 |
| 3 | 商家 OA 與 Mini Store | 舊候選採平台 OA。先明確核對商家獨立 OA 的設定所有權，以兩個測試商家完成讀取、測試、套用、回讀及跨店拒絕，再測點餐、通知與核銷。 |
| 4 | 支付與外部入口 | LINE Pay 使用單一授權 Sandbox 商家驗付款、查詢、退款和對帳。TWQR／街口待收單條件確認。外部入口先驗商家授權與連結映射，再評估訂單寫入。 |

兩個 LINE 候選基底各自完成 LIFF 2.32.0 的本機瀏覽器載入與四種 Flex 模板檢查。11 月 23 日針對候選修補的 npm 正式相依套件稽核，#365 基底仍有 1 critical、9 high，#366 基底仍有 1 critical、12 high、7 moderate。這些統計適用於各候選的整棵相依樹。#366 的 Web 稽核例外綁定舊 lockfile，原授權已在 10 月 22 日到期。整合前應在新基底消除或逐案處理稽核項目，重新驗收。正式服務的暴露程度須另外核對實際部署版本。
