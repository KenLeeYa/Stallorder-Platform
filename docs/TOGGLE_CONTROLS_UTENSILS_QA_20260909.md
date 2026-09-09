# 按鈕式開關與餐具列印檢查

日期：2026-09-09。分支：`codex/toggle-utensils-20260909`；基準：`8acb4b98f0ebe43fcbaf5cc9fe40071c5c5b6abd`。
本次在獨立工作樹實作，以目前 main 樣式為基底；未合入另存的整體介面重新設計，未部署遠端。

## 驗收規則

- 原生打勾框統一呈現按鈕式開關：灰色／左側為未選取，綠色／右側為已選取；部分選取保留中間位置。
- 保留原本 checkbox 的表單資料、必填驗證、預設值、停用、標籤點擊、鍵盤與多選語意。開關外觀不代表自動儲存；原本需要按儲存的表單仍須儲存。
- 一般操作範圍至少 44×44 CSS px；長者模式進一步放大。涵蓋深色、高對比及減少動態效果設定。
- 顧客與店員點餐的多選加料／套餐選項共用開關外觀；外層按鈕保留選取數量上限與 disabled 行為。單選選項維持圓形及 radio 語意。
- 已存在的按鈕式切換控制沿用原本的操作與權限，沒有全面重写元件或改變 API。

## 盤點

TypeScript AST 盤點得到 33 個正式元件、47 處原生 checkbox 宣告。迴圈呈現的多個商品、權限或選項，共用同一宣告；不是只有 47 個畫面控制。全部由 `src/app/globals.css` 統一套用。

以下檔名位於 `src/components/`：

| 功能 | 元件 | 宣告數 |
| --- | --- | ---: |
| 平台帳務操作 | admin-billing-actions.tsx | 1 |
| 平台用量合約 | admin-payg-contract-form.tsx | 1 |
| 出勤 | attendance-manager.tsx | 1 |
| 產能設定 | capacity-settings-form.tsx | 1 |
| 外送串接申請 | delivery-connection-request-form.tsx | 1 |
| 開發者權限及 Webhook | developer-platform-manager.tsx | 2 |
| 會員與成長 | growth-center.tsx | 1 |
| 廚房工作站 | kitchen-stations-manager.tsx | 1 |
| LINE 通知 | line-integration-manager.tsx | 1 |
| 市集活動 | market-event-manager.tsx | 1 |
| 營業類型 | merchant-business-type-option-manager.tsx | 1 |
| 商家商品 | merchant-catalog.tsx | 2 |
| 多攤位報表 | multi-stall-dashboard.tsx | 2 |
| 離線設備 | offline-device-manager.tsx | 1 |
| 初次設定及條款 | onboarding-form.tsx | 2 |
| 營運損益 | operating-profit-dashboard.tsx | 2 |
| 組織成員 | organization-membership-manager.tsx | 1 |
| 金流串接 | payment-integration-manager.tsx | 1 |
| 列印設定共用控制 | print-center-settings.tsx | 1 |
| 商品庫存 | product-stock-editor.tsx | 1 |
| 顧客購物車、餐具、等候確認 | qr-order-cart-panel.tsx | 2 |
| 報表導覽 | report-navigation.tsx | 1 |
| 定期報表 | report-schedule-manager.tsx | 2 |
| 共用商品批次選取 | shared-catalog-board.tsx | 2 |
| 店員人工取餐確認 | staff-order-board-manual-pickup.tsx | 1 |
| 店員看板 | staff-order-board-presentation.tsx | 2 |
| 營業時間 | stall-business-hours-manager.tsx | 1 |
| 攤位商品設定 | stall-catalog-settings.tsx | 3 |
| 攤位基本設定 | stall-editor.tsx | 2 |
| 攤位地點 | stall-location-manager.tsx | 1 |
| 攤位模組 | stall-modules-manager.tsx | 2 |
| 排班及特殊日期 | stall-schedule-manager.tsx | 2 |
| 複製攤位設定 | stall-template-copy-manager.tsx | 1 |

額外兩個自訂多選方框來源：`qr-order-menu.tsx` 與 `staff-order-composer.tsx` 的 `SelectionMark`。兩者的多選分支已改成裝飾性開關，選取行為仍由既有按鈕負責，沒有巢狀互動控制。

## 餐具列印原因與修正

餐具需求目前以訂單備註開頭的 `【免洗餐具：需要】` 記錄。先前廚房單與顧客明細將整段備註交由 `showOrderNote` 判斷，因此關閉「整單備註」會一起隱藏餐具需求。

現在兩種單據透過同一段處理分離餐具需求與自由文字：

| 訂單資料／列印設定 | 列印結果 |
| --- | --- |
| 顧客開啟餐具，整單備註開啟 | `免洗餐具：需要`，另印一般備註 |
| 顧客開啟餐具，整單備註關閉 | 仍印 `免洗餐具：需要`，省略一般備註 |
| 顧客關閉餐具 | 不印需要餐具的提醒；一般備註依規則 |
| 歷史空白備註、未記錄選擇 | 保留原意，不推測為需要或已明確拒絕 |
| 一般文字提到餐具標記，但並非系統開頭格式 | 按一般備註處理 |

這不是新增「每張單都印需要／不需要」欄位；舊資料沒有保存明確的否定值，不能把空白資料當成顧客已回答「不需要」。

多工作站分單、多份、58／80 mm 及三種字級均保留餐具提醒。文字預覽與 StarPRNT bytes 由相同 formatter 產出，系統列印、WebPRNT、CloudPRNT 沿用既有傳輸路徑。

排程後的 payload 維持不可變：新產生的單據在重試與補印時保留需求；**修正前已產生的舊 payload，重試／補印仍沿用舊內容**，不會私下改寫歷史列印工作。

## 驗證與界限

- 修正前，餐具漏印的聚焦回歸為 4 失敗／1 通過；修正後全部通過。
- 聚焦列印、購物車、顧客選項與店員點餐：7 檔 63 項通過。
- 全部 Vitest：528 檔通過、2 檔既有跳過；3064 項通過、9 項既有跳過。
- Chromium 與 WebKit：320／390／768／1440 px，共 8 項通過；含一般／長者、亮／暗色、鍵盤、必填條款、disabled、多個同名 FormData、reset、部分選取與高對比。
- 本機真實頁面：商品、營業時間、產能、排程、成長、開發者、出勤、LINE、列印；四寬度及一般／長者模式。測試中發現開發者及出勤表單的原生欄位最小寬度問題，修正後 9 項通過。
- 店員實際商品選項：滑鼠與 Space 改變選取及取消，四寬度無水平溢位；未送出訂單。
- 顧客實際 QR 選項及購物車：點選／Space 切換、選項加入購物車、繼續填寫資料、餐具需求開／關均通過。窄螢幕長者模式曾因主欄 grid 最小寬度造成分類列 329px 超出 320px；主欄允許縮排後四寬度通過。
- UI audit：324 個 TSX 檔通過；依賴稽核：0 vulnerabilities。
- 全域 lint：0 errors／5 項既有 Next.js 導航 warnings；typecheck 通過。QR 寬度最後修正後，受影響的 4 檔 47 項測試再確認通過。
- 最終本機頁面回歸 11 項通過，另有員工表單 Chromium／WebKit 2 項通過；Next.js 正式建置模式在本機通過（100 個靜態頁面、TypeScript 與路由產出成功）。
- 實機紙張、Star 印表機、LINE 外部發送及 Production 未在本次操作；未更改資料庫 schema、權限、庫存或付款邏輯。
- 本機詳細互動測試使用保留的 3018／55722 all-features 資料，需 `PLAYWRIGHT_REUSE_EXISTING_SERVER=true`；不混入 CI 的標準 seed fixture。獨立開關瀏覽器測試與 unit 不依賴這份資料。

## 店員打卡／排休表單補充修正

同日追加的圖片問題位於 `/attendance/[stallSlug]` 的 `EmployeeWorkforcePanel`。先前外層依螢幕的 `lg` 寬度切成左右兩欄，但頁面自身最大寬度只有 `max-w-2xl`；表單內又依 `sm` 分兩欄，加上 date/text input 的原生最小寬度，造成欄位越界。

修正採用元件實際可用寬度的自適應 grid；假別及說明各占完整一列，開始日與結束日有足夠空間才並排，所有欄位均能縮至容器並填滿所屬欄位。假別、日期、送出申請與既有權限／驗證流程不變。表單原生色彩配置同步亮／暗色模式，修正 WebKit 暗色假別控制曾出現白底白字的問題。

真實打卡頁在修改前重現水平越界；修改後 Chromium 與 WebKit 的 320／390／768／1024／1440 px、一般／長者及亮／暗色組合全部通過。驗證每個欄位及送出按鈕都在表單範圍、原生日期必填仍有效、長說明不撐寬、操作高度至少 44px。測試使用「定位打卡目前未開放」的實際狀態，班表與休假仍可正常顯示；沒有替使用者送出休假或打卡。出勤／休假相關 8 檔 33 項回歸亦通過。

可執行驗證：

```powershell
npm test
npm run lint
npm run typecheck
npm run ui:audit
npm audit --audit-level=moderate
npx playwright test --config e2e/checkbox-toggle.config.ts
$env:PLAYWRIGHT_APP_URL = 'http://127.0.0.1:3018'
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER = 'true'
npx playwright test e2e/toggle-surfaces-local.spec.ts
npx playwright test --config e2e/toggle-surfaces-local.config.ts -g 'Employee leave'
npm run build
```

對應規則：`X-009`、`PRN-010`、`QA-UI-11`、`QA-PRN-06`。
