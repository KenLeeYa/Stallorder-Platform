# 2026-10-02 整合發布候選

## 授權與範圍

使用者要求整合目前本機功能及安全架構工作區，依 Staging → Production 流程發布。本候選整合 responsive HEAD `87230e266281472a71fd764d616be1adf788c635` 的本機修改，以及安全工作區 `c31a5d9b379086b04360430aa71564b083a99292`、`de2096b1333906ae513742b304b60a3583551d02` 的增量。既有手動測試服務與原資料庫保留。

包含跨裝置操作列、共用商品與通知中心、手機長清單、結帳呈現、公開訂單營業時間防護、LINE 平台會員／OA／取餐程式、安全與稽核護欄。程式存在不代表外部服務正式啟用。

## 使用者明確延後

法人／隱私告知與保存期限核定、MFA 恢復設定、獨立稽核封存服務尚未提供，使用者指示先跳過。`COMPLIANCE_ENABLED=false`、`COMPLIANCE_DELETION_DRY_RUN=true` 必須維持；不可宣稱治理、資料刪除或封存已可正式運作。LINE Pay Sandbox 不得進入 Production 真實付款流程。Native 五項功能旗標維持預設 false，定義移至 Primary 專用 fixture，不能在 DR schema 階段寫入複寫表。

## 本次修正與證據邊界

- DR 複寫表分類由 135 補齊至 144；Sandbox 付款測試資料留在環境本地。独立審查 60 項測試通過，尚不等於遠端 publication／資料同步證據。
- 保留持久稽核紀錄不可刪除；測試清理改為保留並讀回稽核證據。
- 私有歷史 schema fixture 的測試改為可攜合成契約測試；不將這些測試冒充歷史實機／資料庫 corpus 的重新驗證。
- 本機完整單元測試初輪 4,115 通過、106 跳過；UI 稽核 395 TSX 通過；最終候選須另確認提交後檢查。
- TypeScript 與整合工作區 production build 通過。正式部署及實際登入／受影響訂單流程仍須獨立驗證。
- 同一個既有 Docker 專案內，以精確暫存資料庫 `stallorder_release_upgrade_20261002` 驗證六項安全／feedback migration 升級；未 reset 原本 `postgres`，未新增 Docker 專案。還原排除環境本地 pg_cron，因此此演練不證明排程執行。
- GitHub Preview 環境新增 required reviewer `KenLeeYa`（9008698）；並未因此發布應用或寫入正式資料庫。

## 發布狀態

目前是整合候選，尚未發布正式站。後續需候選 CI、新建資料庫遷移、Staging 實際流程、精確 tree／Plan 綁定、DR／Primary 提交與部署讀回、Production 受影響流程及 DR 同步驗證。失敗、跳過與外部未設定項目不得計入通過。

## 2026-10-03 續作

- 草稿 PR366 已建立；`a30cec90` 本機完整單元測試為 4,121 通過、106 跳過。雲端同版本因單元測試使用 Chromium、但流程太晚安裝瀏覽器而失敗；已將瀏覽器安裝移至測試前，後續須重跑。
- Primary 與 DR 的實際 migration head 均為 `20260912112200`，原候選需 26 項遷移；新增 forward migration 修復依時間順序升級時外送 CHECK 覆蓋隱私刪除約束的問題。重現失敗後，clone 16 項實際外送契約測試通過；不改歷史 migration。
- Primary 通知已讀回填已接入發布流程、位於 schema Apply 後及 Edge／應用更新前。專用 clone runner 的七項實際測試通過，交易回滾並讀回 runtime 狀態不變；正式回填尚未執行。
- 原有 staging environment 指向正式 DR 的 Supabase project，不能寫入候選測試資料。PR366 的隔離 Staging 方案另列，尚待新的限時付費測試授權；原 PR365 授權不延用。
- 完整倉庫依賴掃描有七項漏洞，屬未發布的 Native／Expo 相依鏈；不得宣稱完整倉庫或 Native 安全通過。正式 Web 的獨立 artifact 範圍仍需依賴閉包及部署產物證據，不得只以路徑搜尋代替放行。
