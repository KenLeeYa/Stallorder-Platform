# 實作中的設計系統

沿用 React 19、Tailwind 4、Lucide、既有 message catalog 與原生 dialog。沒有加入新的產品 UI framework。可執行元件以真實頁面／Playwright 截圖作為文件，不建立脫離 API 的演示站。

| 層級 | 已有／新增 token 或慣例 | 用途 |
|---|---|---|
| 背景／文字 | --background、--foreground；既有 dark stone palette | 明暗主題 |
| 控制 | --focus-ring、--field-border、--field-border-invalid、--field-background | 焦點／表單錯誤 |
| 尺寸 | --control-target: 2.75rem、--radius-panel: .75rem | 44px 觸控與區塊規範；既有 Tailwind min-h-11 等價 |
| 字型 | Geist + PingFang TC／Microsoft JhengHei／Noto Sans TC／sans-serif | 不下載額外中文字型、保留 OS 可讀字型 |
| 狀態 | 字詞＋顏色＋aria-pressed/current；font-semibold | 色弱、鍵盤使用者可辨識 |
| 長者 | 根字級 112.5%；核心資料文字至少 1rem、行高 1.65、主要資料操作最少3rem | 包含品項、備註、金額與欄位，不只圖示 |

## 元件契約

- StaffTicketList：工作篩選是按鈕群組，不冒充 tabs；計數、分頁 status 可供朗讀；作用範圍保持 active read model。
- StaffSelectedOrderWorkspace：保留三區、獨立垂直捲動、長品名換行；危險取消與付款／交付 command 沿用既有確認視窗。
- SharedCatalogBoard：分類→群組→品項；主檔／單攤位影響範圍原有文字保留；checkbox 為批次選取、不是滑動開關。
- ProductAvailabilityEditor：五種明確模式、只展開相關時間欄位；保存忙碌鎖、同步重入鎖、錯誤不關閉 dialog、不清空日期；Escape／關閉返回觸發按鈕。
- QrOrderCartPanel：label 與輸入 id 明確關聯，保留 placeholder 範例；結帳群組關聯標題與阻擋原因，aria-busy 表示送出中；不新增收件資料要求。
- MerchantModuleLink：保留 Next Link 行為與 server 決定的顯示條件，現在位置同時有文字與 aria-current。

## 不採用的視覺變更

不將批次 checkbox 又改回佔空間的滑動開關；不以顏色取代付款文字；不把所有次要設定展開佔據訂單工作區；不增加動畫、模糊遮罩或自訂聲音來掩蓋交易問題。

安全／交易確認、錯誤 dialog、loading skeleton、空狀態與現有資料表保持各自既有元件，不為了文件齊全另建重複元件。

## 既有元件對照（不另建平行抽象）

| 合約 | 實際來源／使用方式 | 本輪策略 |
|---|---|---|
| Button／IconButton／Tabs | native button + Lucide、aria-pressed、globals focus-visible | 工作篩選、dialog、分頁 min-h-11；title 不能取代 accessible name |
| Input／Select／Checkbox／Radio／Switch | form-input、ordering-checkbox、native select、現有 role=switch 設定 | 選取用 checkbox；供應五模式為 pressed buttons；不把兩者混用 |
| Dialog／Drawer／ConfirmAction | ExperienceDialog、PublicOrderFeedbackDialog、StaffOrderCancellationDialog、StaffOrderCheckoutDialog | 保留交易專用確認；供應 editor 本輪補焦點圈、返回與 busy 保護 |
| Toast／Banner／Error／Offline | settings-feedback-dialog、ordering-unavailable-dialog、billing-status-banner、PwaControls、staff-order-board-live | 狀態優先文字、aria-live；故障提示不得引導重新支付未知交易 |
| DataTable／Card／Badge | SharedCatalogBoard、MultiStallDashboard、StaffTicketList、report pagination | 桌面表格／三欄、手機卡片；頁數與作用範圍清楚 |
| Skeleton／EmptyState | route-loading-skeleton、DashboardDataSkeleton、現有零筆提示 | 不為純視覺統一改寫所有狀態元件；不把缺資料變 0 |
| Money／StatusTimeline | lib/money、locale-format、public-order-tracker、contextualOrderStatusLabel | 使用既有幣別／語系，不在 presentation 重新計價 |

### 密度與互動規範

- 間距沿用 Tailwind 4 的 4px 基礎步階：內容 gap-2/3、區塊 p-3/4；圓角 md/lg/xl 維持既有品牌。
- 狀態色使用既有 teal/emerald/amber/red，配對文字；暗色對應集中 globals.css。表面、邊框、focus 同源，不每頁自行配色。
- z-index：工作 header z-30、既有 modal 層；原生 dialog 使用 top layer。不能用更高 z-index 修復漏掉的焦點或 nested Escape。
- 金額與數量固定數字格式；計數用 tabular-nums；長品名／註記 break-words，不壓縮可點擊區。
- 手機 <768 卡片；平板 >=768 三區以 minmax(0,fr) 分配並各自捲動；1280 以上增加間距。320/360 最窄仍保持主操作可達。
- 動畫沿用現有 reduced-motion 規則，不增加過場。高對比依文字／邊框／focus 可辨識，尚未宣稱 Windows forced-colors 完整驗證。
- 預設、hover、focus-visible、pressed、disabled、busy、錯誤按實際 native/ARIA 狀態呈現，避免做外觀正常卻可以重送的按鈕。
