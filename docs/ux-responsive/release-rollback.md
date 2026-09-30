# 分片、Gate 與回退邊界

狀態：設計於 2026-09-30 已核准。此文件是設計的順序／風險；[implementation plan](../superpowers/plans/2026-09-30-responsive-cross-device.md)待審閱，並非正式發布 Plan。

## Gate

需求檔第13節及brainstorming architectural path要求：書面規格核准→writing-plans→書面實作計畫審閱與執行方式選擇→本機分片實作／測試。一般已核准的小步驟不反覆詢問。若新增後端交易權威、租戶邊界或收集個資，先列具體差異。

已核准B方案，共用資料/任務＋角色呈現，保留三欄預設與窄直向展開明細。設計核准不等於Production、LINE或費用授權。

## 本機切片順序

1. 取得穩定隔離候選。3023與候選不同版本，先比對被觸及檔案及未提交patch。保留手測環境，不切3023分支或在其`.next`同時build。
2. 共用小範圍token／dialog／header契約；每個受影響角色回歸。避免先全站重寫AppShell。
3. 顧客手機與第一個四端同單閉環；保留server價格、必選、庫存、重送、付款狀態。
4. Staff／POS／KDS觸控、三欄與手機明細；先證明KDS亂序失敗，再修生命週期；不可虛构orderVersion。
5. Merchant與Admin的內容驅動表格／卡片、返回、導航與角色負例。
6. 全尺寸／a11y／state／效能／實機回歸；如實列NOT_RUN與外部依賴。

每批小diff、固定候選SHA/patch hash、對應測試與before/after。若既有flag適用，可在隔離fixture驗新舊renderer；不開Production旗標。

## 服務與資料

本輪啟動：無。停止：無。保留使用者手測：3023（ui-ux-redesign工作樹）、55722（catalog-ops Supabase DB容器）。沒有reset、prune、刪容器/volume、沒有新Cloud資源、沒有延長已清理LINE Preview。

未來需要新服務時先查lifecycle文件、容器labels、port與process tree，明確記exact project/DB/port；不得只依cwd推定ownership。結束測試停止本次新增服務，人工環境保留例外要記載。

現有3023恢復方式（僅停止且使用者需要时）：在其worktree執行 `node scripts/start-local-qa.mjs --port 3023`；先核對55722容器label與現有consumer，已有listener不重啟、不建立第二個server。

## 回退

本階段只有新文件／證據，不改runtime，沒有Production回退動作。產品實作每批以獨立commit保存；有缺陷時回退該批UI，保留已成立原單、付款、print jobs與audit。禁止為回退CSS回灌DB或刪測試資料。

需發布時另遵循Staging先驗、fresh Plan/commit/tree、單一remote writer、Primary/DR明確ID、部署/alias/backend讀回、真實hostname登入與受影響合法QR流程。不得用HTTP200或READY宣稱全流程通過。PR365既有release blockers須另核對，這輪不自動merge／deploy。

LINE MINI Endpoint、OA rich menu/webhook、付款credentials、DNS、正式訊息、真實退款／開櫃不在此次設計／本機更新授權；既有LINE Preview清理與停用排程保持已結束狀態。
