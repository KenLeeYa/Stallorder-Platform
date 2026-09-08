# 本機功能整合發布（2026-09-08）

狀態：Release candidate，正式結果以相同 commit/tree 的受保護工作流程收據與上線回查為準。

使用者已授權自動完成本次 LINE 引導及先前本機功能新增、修正的正式發布。整合基準為已驗證 staging `0aafe50`，功能來源為本機 `codex/catalog-operations-20260907` 的 `d1573e3`。保留正式底版的原始密鑰同步、恢復驗證及 DR 修正。整體介面重設計 `0cb5540` 留在獨立分支，本次沿用先前還原的操作版型及後續明確要求的商品、註記與看板改善。

## 納入範圍

- 顧客改單、取餐時間提案接受／拒絕／再次提案、背景查詢獨立配額與重試等待、並行取消及舊狀態防護。
- 餐具選項、特殊店休既有預約提醒、系統無法點餐時保留購物車的提示。
- 每攤位商品可售份數、修改差額扣補、製作後不回補、批次庫存與售完管理。
- QR 最後點餐時間、含第 N 天的預約範圍、特殊營業時段與店休限制。
- 紙本桌位 QR 與主要 QR 輪替分離、暫停後開放恢復、權限移除及相依設定提醒。
- 商品分類／群組／品項呈現、左右區塊等高、平板桌機註記管理與單一註記子視窗保留清單。
- 店員新單音效與三區滿版看板、抽獎內用渠道及贈品折扣快照修正、模擬付款介面錯誤恢復。
- 商家 LINE 首次設定四步引導、欄位提示及正確的顧客 Callback URL。

本機所有功能啟用腳本和保留範例資料屬於隔離 QA 環境，不會在正式資料庫執行。未完成的 foundation 模組、生日驗證及供應商功能仍保留既有伺服器限制；發布程式不等於商家 LINE、金流或硬體已完成真實交易驗收。

## 資料與發布相依

新增 migration `20260907151000`、`20260907151100`、`20260907190000`、`20260907200000`、`20260907200100`、`20260907200200`，須與應用及 Edge Functions 一併發布。未修改先前已發布 migration。庫存預設不限量、最後點餐時間預設空值，保留既有商家設定；不回填或重建正式訂單。

完整執行順序為：本機整合驗證 → PR 配對 Supabase/Vercel Preview → staging 驗證 → 相同 tree 的 main PR → DR schema Plan/Apply → 綁定 DR 收據的 Production Readiness Plan/Apply → 綁定 Primary 收據的增量複寫 Plan/Apply → 正式與 DR 健康、QR smoke 和 migration 回查。每一筆 Plan 必須來自本次不可變 commit，不使用早先單獨 LINE 發布候選或歷史 Plan。

新增本機 E2E 的資料寫入限制保留 loopback 及專用 DB 55722；在 CI 僅接受 CI 自建的 loopback DB 54322。瀏覽器仍測試真實 Node/Edge、庫存及狀態交易，第三方傳送使用既有 mock，不觸及正式顧客。

## 驗證記錄

整合後須完成 lint、UI audit、typecheck、全部 unit/contract、空白資料庫依序 migration、pgTAP、DB lint、build、dependency/secret/security 檢查及完整 CI E2E。保留式本機訂單、手機／平板／桌機測試和第三方限制的歷史紀錄分別見各功能文件；歷史的「僅本機」狀態由本發布紀錄及後續收據補充，不把歷史測試當成正式驗收。

本機 fresh database 使用 Git 內的原始 SQL bytes，與 Linux CI 一致，避免 Windows 自動 CRLF 使 SQL 函式文字錨點不一致。既有 migration 的內容不因此改寫。

整合檢查同步註記 dialog 的可及性契約：只有前景 dialog 宣告 modal，保留的背景 navigator 為 aria-hidden。Prisma generate 必須完成後才啟動 unit 測試，避免 Client 產生期間的暫時模組缺失。

整合候選的新鮮驗證：完整 lint／UI audit／typecheck／build 通過，143 支 migration 在空白資料庫依序套用、71 個 pgTAP 檔案共 1,603 項斷言及 DB lint 通過。38 個顧客、店員、商品、註記、付款及 LINE 瀏覽器案例的最後一次結果均通過；其中 24 項環境對齊重測全數通過，閒置追蹤實測 369 秒、126 次讀取無錯誤，之後的 429 等待與恢復亦通過。全套 unit/contract、dependency/secret 掃描和雲端檢查以最後候選的產物為準。

既有 additive release gate 依 SQL 指紋審查函式更換與既有資料表 trigger。本次沿用該機制登錄上述六支已審查 migration 的完整內容指紋；只讓完全相符的庫存 migration 建立 deferred constraint triggers，仍執行原本的 statement、grant、資料刪除、RLS 及 schema 破壞檢查。新增六項正向與竄改／附加 DROP／附加匿名授權的拒絕測試；與發布流程契約合計 120 項通過。每次遠端 Plan/Apply 仍比對 commit、tree、migration 清單與內容 digest。

尖峰訂單範例使用獨立 QA 店主執行，避免保留資料使 CI 共用帳號在後續測試多出組織選擇頁。本機仍賦予原有商家、店員與廚房測試帳號查看範例的權限；CI 只保留獨立身分，無須刪除範例資料。獨立身分的尖峰加時、暫停／恢復、關店、庫存與店員／廚房案例重新執行通過。

雲端正式模式 E2E 揭露新增測試缺少 Circuit B 功能開關前置條件；catalog 與 functional QA 改為在已驗證的隔離資料庫建立有期限的測試 override，結束後只移除自己建立的 override。正式功能預設與 gate 保持原有規則。

補驗以 Next production server 執行上述兩組完整流程，14 項全數通過，包含零庫存改單、併發超賣、Node／Edge、紙本桌位 QR、撤銷權限、三輪取餐時間提案、雙分頁、逾時與取消競態。

相同的 Circuit B fixture 前置條件一併套用於閒置追蹤與訂單體驗測試；正式執行模式補驗 3 項通過，包含真實閒置 367 秒、125 次讀取、429 等待恢復、新單音效與特殊店休公告。既有 compact-switcher 瀏覽器斷言仍沿用舊 QR／按鈕左右排列，與已保留的 `fd86e43` 功能版及 `local-qa-readiness` 契約不符；改為檢查現有平板／電腦管理側欄、直接可見的商品區、手機按需開啟，以及 QR 尺寸和整頁不溢位。應用版型未因此改動。

付款模擬 fixture 明確開啟隔離資料庫的付款管理介面，結束後移除自身 override；Playwright 自建的 loopback Preview server 明確使用 mock payment mode，正式 runtime policy 仍拒絕 Production mock。付款及 LINE 引導在 production server 的 9 項案例與付款安全契約 7 項全部通過。QR 側欄亦通過手機、平板、縮放桌機及桌機驗證；本機保留多組織時由正常選擇組織頁進入指定測試組織。

完整 CI 的三項測試前置條件已重現並修正：付款頁等待既有兩秒 feature snapshot 快取反映臨時 override；單一註記排序建立自身前一筆資料並核對資料庫排序，結束後只移除自身 fixture；抽獎／預約整合在 PATCH 後完成成功視窗及未儲存狀態的確認，才離開設定頁。原先未預期 beforeunload 的失敗斷言仍保留，未修改應用儲存邏輯或放寬檢查。四項 focused production server 案例全數通過，完整 CI 以新候選重新執行。

後段 CI 另揭露報表測試的日期相依性：「昨天到今天」在週二會匹配 WEEK，須先按「自訂」再測試日期欄位與匯出。補驗明確要求兩個日期欄位存在，保留尺寸／匯出內容檢查。商品工具列則加入已提供的桌機／平板分類排序按鈕，手機只計入可見控制項並確認排序按鈕隱藏。兩項 production server 案例、lint 與 typecheck 通過。先前本機補跑因建置時缺少測試 site key 而停用送單，依 CI build 環境重建後，五项 QR 改單／購物車／送單案例通過；其餘保留資料造成的多組織選擇、翻譯完整度及加點提示差異，與乾淨 CI fixture 的驗證結果分開記錄。
