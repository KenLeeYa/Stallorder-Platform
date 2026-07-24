# StallOrder 全系統 UI/UX 與輸入安全基準

更新日期：2026-07-24

## 目標

本輪優化以夜市攤位、餐車與行動攤商的高頻操作為核心，優先降低手機點餐、店員代點餐、廚房出餐與平台審核的操作步驟，同時保留既有 RLS、RBAC、CSRF、Turnstile、rate limiting、QR session、idempotency 與稽核紀錄。

## 同類產品參考

| 來源 | 採用原則 | StallOrder 對應 |
| --- | --- | --- |
| [iCHEF 點餐介面](https://www.ichefpos.com/zh-tw/interface-flow) | 菜單與購物車保持在同一個操作脈絡，減少往返頁面 | 桌面使用左右分欄；手機使用商品／購物車雙階段與固定訂單摘要 |
| [iCHEF 內用點餐](https://www.ichefpos.com/zh-tw/dine-in-ordering) | 桌位狀態應接近現場平面配置 | 保留桌位畫盤與桌次合併，行動裝置優先顯示可操作狀態 |
| [Square Restaurants](https://squareup.com/us/en/point-of-sale/restaurants) | 圖片菜單、快速售罄及手持裝置操作 | 商品卡片保留穩定圖片比例、數量控制與供應狀態 |
| [Square KDS](https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system) | POS、線上訂單與 KDS 使用同一筆權威訂單資料 | Realtime 僅通知，畫面收到事件後重新取得伺服器資料 |
| [Toast KDS](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html) | 依等待時間分級、工作站與大尺寸觸控操作 | KDS 保留 normal／warning／critical 分級及站點工作流 |

## 裝置驗收矩陣

| 寬度 | 主要裝置 | 驗收重點 |
| --- | --- | --- |
| 360 px | 小型 Android 手機 | 不得水平捲動；輸入時不得自動縮放；主要按鈕至少 44 px |
| 390 px | iPhone／主流 Android | QR 點餐、店員代點餐、登入與管理清單可單手完成 |
| 768 px | 平板直向 | 表單可雙欄但不得壓縮標籤；KDS 與桌位操作可觸控 |
| 1024 px | 平板橫向／小型筆電 | 菜單與訂單摘要並列；操作列不遮蔽內容 |
| 1440 px | 桌面 | 資訊密度提高，但每個區塊仍維持清楚層級與鍵盤焦點 |

## 本輪改善

### 全域

- 加入跳至主要內容連結、清楚的 `focus-visible`、停用與錯誤狀態。
- 手機表單字級至少 16 px，避免 iOS 聚焦輸入框時自動縮放。
- 觸控控制使用穩定尺寸，並支援安全區底部留白。
- 尊重 `prefers-reduced-motion`，降低不必要動畫。
- 所有原生 `input` 皆有明確 `type`；提交與一般操作按鈕明確區分。

### 顧客 QR 點餐

- 手機商品瀏覽與購物車改為雙階段操作。
- 選取商品後固定顯示數量與總額，可直接開啟訂單摘要。
- 類別提供橫向快速導覽，商品圖片與數量控制不互相擠壓。
- Turnstile、短效 order session、伺服器價格驗證與送單限制維持不變。

### 店員代點餐

- 手機改為「選擇商品／訂單與結帳」兩段式操作。
- 固定顯示購物車總數與金額，減少長商品清單中的來回捲動。
- 內用、外帶、外送欄位依情境顯示正確鍵盤與格式限制。

### 商家與平台管理

- 平台申請清單在手機改為卡片，桌面維持可比較的表格。
- 搜尋欄使用 `search` 型態，數字、日期、經緯度與金額使用對應型態及上下限。
- 長清單保留分頁；危險操作與一般操作維持不同視覺層級。

## 輸入資料防線

瀏覽器欄位限制只改善操作體驗，不作為安全信任邊界。所有寫入流程至少維持以下層次：

1. **欄位語意**：`email`、`tel`、`url`、`number`、`date` 等正確型態，以及 `maxLength`、`min`、`max`、`step`。
2. **請求邊界**：JSON API 僅接受 `application/json`，並維持 32 KB request body 上限。
3. **伺服器 schema**：Zod 使用 `.strict()` 拒絕未定義欄位；單行文字拒絕控制字元，多行文字只允許正常換行。
4. **情境驗證**：電話、公開識別名稱、UUID、金額、數量、日期與經緯度各自使用專用規則。
5. **授權與資料隔離**：由伺服器 session、組織與攤位 membership 決定範圍，不接受前端自行指定 tenant 權限。
6. **輸出安全**：React 預設 escaping 保留；不得使用未受控的 `dangerouslySetInnerHTML`。

執行以下指令可檢查原生控制項的基本契約：

```powershell
npm run ui:audit
```

## QA 驗收

- 各裝置寬度不得出現非預期水平捲動或內容重疊。
- 鍵盤可到達所有互動控制，焦點狀態清楚可見。
- 行動裝置主要操作不應依賴 hover。
- 對話框開啟時不得讓背景頁面持續捲動。
- 表單錯誤應鄰近欄位或使用 `role="alert"`，不得只靠顏色。
- 載入、無資料、失敗、停用及權限不足狀態都必須有明確回饋。
- UI 限制遭繞過時，伺服器仍必須拒絕不合規資料。
