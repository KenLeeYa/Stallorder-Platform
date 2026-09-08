# 本機介面還原與改版分支保留（2026-09-07）

依使用者最新指示，將整批介面改版留在獨立分支供稍後測試；3018 改回整體 UX 改版前的介面，保留功能新增與修正。這次沒有回滾資料庫、訂單或正式部署。

## 版本與入口

| 用途 | 分支 | 程式基準 |
| --- | --- | --- |
| 目前本機 3018 | `codex/catalog-operations-20260907` | `fd86e436f69cfa7b401a26d9c3da7496cf9c749b`，本次只補分流文件 |
| 介面改版，保留待測 | `codex/responsive-workflows-20260907` | `0cb5540727733515bdfaa26b9ae5b2f3d0a986a8`，完整保留且未改寫 |

- 目前工作目錄：`C:\Users\KY\Documents\Codex projects\Stallorder-Platform-catalog-operations-20260907`。
- 本機入口：[登入](http://127.0.0.1:3018/login)、[商品管理](http://127.0.0.1:3018/merchant/catalog)。
- 新介面驗收說明、畫面及測試保留在改版分支的 `docs/RESPONSIVE_WORKFLOWS_20260907.md`。
- 原始 `Stallorder-Platform` 工作區的未提交內容及其他工作區均保留。

## 還原範圍與保留功能

還原的是整體 UX 改版：商家／店員／廚房／平台導覽、次要工具呈現、表格與手機資料卡、長者資料／表單樣式、相關設定捷徑，以及配合新版 QR 購物車的斷點與開關行為。原有導覽、表格、長者選單與 QR 購物車回到 `fd86e43` 的既有呈現。

下列先前新增功能及其必要操作介面保留，不將整個應用回退至舊正式版本：

- 顧客修改訂單、取餐時間接受／拒絕、商家確認後禁止修改的修正。
- 可售份數、交易扣補庫存、整批售完／恢復、群組商品管理與庫存設定。
- QR 最後點餐時間、含第 N 天的預約範圍、特殊營業／店休限制。
- 印刷桌位 QR 沿用與主 QR 輪替修正、成員移除權限及連動提醒。
- 只有新單提示音、免洗餐具、店休公告與當日視窗、維護遮罩。
- 先前已確認的店員三區滿版看板與手機單欄流程。

功能詳細規則及既有驗收記錄：[商品、預約與 QR](CATALOG_OPERATIONS_LOCAL_20260907.md)、[訂單與店員看板](LOCAL_ORDER_EXPERIENCE_20260907.md)。本文件的「還原」指回到整體改版前的外觀；新增功能所需的欄位和操作仍存在，因此不宣稱與舊正式版本逐像素相同。

## 驗證

- 切換前工作區乾淨；確認改版提交的直接父提交為功能基準。
- `src`、`prisma`、`supabase` 以功能基準的 Git tree 為準；本次不另寫一份反向修補，也不改套件、環境變數或 migration。
- 重新建置成功；5 個既有介面契約測試檔、22 項測試通過；323 個 TSX 控制項稽核通過。
- 實際本機流程通過：商品／QR／權限 7 項、音效／店休 2 項、QR／外帶修改 2 項、手機與三區看板 1 項，共 12 個不同案例。涵蓋 Node／Edge 庫存、零庫存原單修改、超賣拒絕、預約／截單、印刷 QR、成員撤權、餐具還原與維護後購物車保留。
- 首次將前 11 項連跑時，後兩項顧客測試因本機共用限流計數累積而收到 HTTP 429；trace 確認 `RATE_LIMITED`。僅清除獨立 55722 lab 的測試限流計數後，原斷言及原政策下重跑顧客與看板 3 項全數通過。未調高限流門檻、延長 timeout 或跳過測試。
- 攤位成員頁另以 Chromium 檢查 320、390、768、1440 寬度：恢復原圖示工具列、44px 操作、沒有整頁水平溢位，沒有頁面執行錯誤。電腦及手機截圖已人工檢視。
- 3018 啟動資訊確認實際工作目錄及功能基準；登入和成員頁 HTTP 200。原始工作區未提交 diff SHA-256 仍為 `b3489daa805d36390dd52648f6eb05de4059a0a5250c482309d6598d1ee78b66`。
- 本次沒有修改應用原始碼或資料庫，未重跑全部單元測試、pgTAP、實體 iPad／列印或正式端到端測試；既有功能的完整歷史證據見前述功能文件。
- 沒有 push、Staging、Production 或遠端資料寫入。本機沿用獨立 Supabase lab：API 55721、DB 55722。

本次輸出位於 `C:\Users\KY\.codex\visualizations\2026\09\06\01a0761b-0cdb-73e1-82cc-59a3e93d5d66`：`functional-baseline-build.log`、`functional-baseline-unit.log`、`functional-baseline-controls.log`、`functional-baseline-e2e.log`、`functional-baseline-qr-board.log`、`functional-baseline-ui.log`、`functional-baseline-members-{320,390,768,1440}.png`。首次限流失敗的 trace 亦另存於該目錄供追查。

## 稍後測試新介面

先確認此工作區乾淨並停止其 3018 服務，再切換到 `codex/responsive-workflows-20260907`，以 `npm run dev:qa -- --port 3018` 啟動。不要在服務仍執行時切分支或同時建置同一個 `.next`。恢復目前功能版時使用同樣流程切回 `codex/catalog-operations-20260907`；兩個版本共用同一份本機功能資料，無需重設或回滾資料庫。
