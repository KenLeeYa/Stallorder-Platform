# 點餐勾選介面與後續管理介面建議

本次依 2026-09-11 使用者要求，恢復點餐選項的打勾式呈現；管理頁面的全面改版先提出建議。

## 分支與範圍

- 分支：`codex/order-selection-checkboxes-20260911`。
- 基底：開始工作時的正式版本 `202a3c2debfe8a668177521ea10100c7711b293a`，包含已完成的列印恢復修正。
- 本機獨立 worktree：`Stallorder-Platform-order-selection-checkboxes-20260911`。本次沒有推送、合併或部署正式環境。
- 根因：全域 CSS 曾將所有 checkbox 畫為滑動開關；顧客與店員餐點複選也採用相同的大型滑動標記。
- 已調整：店員點餐、QR、外帶自取、外送的加購／註記／套餐複選；餐具與等待確認；店員看板的品項勾選與人工取餐核對。
- 方形勾選本體為 24px；手機／平板長者模式隨字級為 27px。選項卡及文字標籤仍保留至少 44px 可點範圍。單選保留圓形。
- 維持原有選擇上限、必選規則、鍵盤操作、價格／購物車邏輯。店員品項勾選在列印模式保持隱藏。
- 餐具提示中的「開啟／關閉」同步改為「勾選／不勾選」，並調整英文、日文說明；其他三種語言原本已使用選取語意。

## 實際預覽

[顧客手機畫面](C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/order-selection-checkboxes-20260911/preview-customer-mobile.png) · [顧客平板畫面](C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/order-selection-checkboxes-20260911/preview-customer-tablet.png) · [長者／深色畫面](C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/order-selection-checkboxes-20260911/preview-customer-senior.png) · [店員手機畫面](C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/order-selection-checkboxes-20260911/preview-staff-mobile.png)

以上為本機實際元件的測試截圖；顧客畫面使用合成菜單。

## 管理頁面建議（尚未全面實作）

| 使用情境 | 建議呈現 | 操作方式 |
| --- | --- | --- |
| 商品清單、全選、批次選取 | 22–24px 方形勾選框，整列可點選 | 全選呈現未選／部分選取／全部選取；有選取時才顯示「已選 N 項」和批次操作列 |
| 商品供應、售完狀態 | 「供應中」「已售完」文字狀態按鈕 | 點按切換或開啟狀態操作；庫存不足仍依既有伺服器規則限制，不能只改顯示 |
| 獨立功能啟用／停用 | 約 36×20px 的小型開關，加上狀態文字 | 整個文字列至少 44px 可點；需儲存的設定維持明確儲存動作 |
| 手機管理頁 | 單欄緊湊清單，次要操作收入「更多」 | 選取後才出現底部批次操作，內容預留空間避免被遮住 |
| 平板／電腦管理頁 | 左側分類、右側列表，固定狀態與操作欄 | 有選取時於清單上方顯示批次列，減少每一列重複出現大型控制 |

優先建議先改善附圖中的「全選／商品批次勾選」，再處理供應狀態和真正的功能開關。長者模式加大文字、間距與點按範圍，避免單純放大控制圖形。

設計依據：透過 AnySearch 讀取 [Material Design 3 checkbox guidelines](https://m3.material.io/components/checkbox/guidelines)。該指南建議相關項目的多選使用 checkbox，並以部分選取狀態表示父層選取情況。本表是依 StallOrder 工作流程提出的應用建議。

## 驗證

對應 `X-009`、`QA-UI-01/02/03/04/11`，以及餐具 `QR-026` 的呈現／資料保留部分。

- 已先建立失敗案例，確認 DEFAULT／PREORDER／DELIVERY 的餐點複選仍使用滑動標記，之後修正。
- 功能單元測試：QR 選項、購物車、session controller、註記選擇、餐具備註與人工取餐核對。
- CSS 瀏覽器測試：320／390／768／1440，Chrome 與 WebKit，標準／長者、淺色／深色、高對比，文字點選、Space、disabled、required、reset、多值表單與列印隱藏。
- 實際介面測試：QR、外帶、外送從正確入口進入；單選互斥、複選上限、加入購物車、餐具及等待確認。店員使用保留的本機測試資料，驗證點餐及三欄／手機看板品項勾選與操作區分隔。
- 顧客 session API 使用固定測試回應；未送出新訂單。這是介面／互動 QA，不能當作付款、實體 iPad、印表機或正式下單端到端驗收。
- 最終結果：54 項單元測試、8 項 CSS／原生表單瀏覽器測試、10 項實際介面流程測試通過。餐具說明改為勾選語意後，6 項顧客流程再測全部通過。
- TypeScript、變更檔案 ESLint、324 個 TSX 的 UI 控制檢查、Git 空白檢查通過。未執行正式 release build、完整交易／資料庫／供應商回歸，本次不宣告正式發布就緒。
- 預約與外送測試分別走 `/s/aming-chicken`、`/delivery/aming-chicken`，由既有轉址進入 `/store/aming-01`。QR 的入口／模式限制維持不變。
- 收據與截圖：`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/order-selection-checkboxes-20260911`。可用其中 `run-ordering-selection-qa.mjs` 重新執行本機流程測試；執行前需依服務生命週期文件啟動既有 55722 測試資料庫。

測試暫用 3058（應用程式）、55431（OAuth mock）、55722（既有介面 QA 資料庫）。已確認沒有剩餘測試 DB 連線後停止 DB 容器 `59f8e85233fa`；狀態為 exited，三個連接埠均無監聽，測試資料與 volumes 保留。兩組供應鏈及 KuanGuard 服務維持運行。本機目前沒有保留持續運行的點餐預覽伺服器。
