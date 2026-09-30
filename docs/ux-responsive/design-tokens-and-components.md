# 設計 token 與元件契約（設計已核准；尚未實作）

## 沿用現有視覺

`src/app/globals.css` 已有淺色 `#fafaf9/#1c1917`、深色 `#0c0a09/#fafaf9`、teal focus、`--control-target:2.75rem`、`--radius-panel:.75rem`、CJK字型、safe-area與reduced-motion；`docs/ui-ux/design-system.md` 有semantic `--ui-*`。品牌只顯示「攤點通」，不重新加入英文wordmark。

不新增平行token系統。實作時只將重複的panel寬度、dialog高度、主動作尺寸導入既有token；先列消費面與回歸，不全域改所有button selector。

| 項目 | 提案基線 | 驗證 |
|---|---|---|
| 文字 | 正文16px；次要資訊保留可讀性；金額／取餐號可突出，不靠縮字塞滿 | 中文長品名、英文／越文、200%文字 |
| 圖示按鈕 | 可視圖示20–24px；命中區≥44×44，忙碌現場48px | 實際rect＋遮擋／間距，不只class |
| Primary CTA | 顧客／Staff／POS／KDS48–56px | 粗指標與桌機觸控仍合格 |
| Desktop密度 | 保留44px可點範圍；內容可緊湊 | 不因pointer fine破壞鍵盤／觸控 |
| 表面／狀態 | 原teal主動作；警告／危險有文字和圖示 | 明暗對比、禁用仍可理解 |
| 間距 | 沿用4px步階；主／危險動作至少有可見分隔與觸控餘裕 | 避免手指誤觸；不任意堆大空白 |
| 圓角／陰影 | 現有12px panel與有界overlay；陰影只標層級 | 高對比與暗色仍辨識 |
| 安全區 | env(safe-area-inset-*)＋footer實高；100dvh優先 | 真機鍵盤、旋轉、瀏覽器底條 |

## 元件清單與最小變更面

| 契約 | 現有來源／復用方式 | 必備狀態或重點 |
|---|---|---|
| AppShell／Navigation | `workspace-function-navigation.tsx`、MerchantHeader、AdminBillingHeader、Staff/KDS現有header | role授權、active、overflow、focus、所有功能僅手機適用範圍 |
| Dialog／ConfirmAction | 優先 `ExperienceDialog`；QR已有`qr-order-dialog-lifecycle.ts` | 開關／巢狀／error／pending／focus restore；不得粗暴替換業務 |
| BottomActionBar／CartSummary | QR presentation與Staff composer現有bar | 份數總額、disabled原因、safe-area、鍵盤 |
| OrderCard／OrderDetail | Staff現有卡片／中右欄，共用controller | loading／selected／stale／pending／conflict；手機內容不可被桌機去重誤刪 |
| StatusBadge | 既有狀態mapping | icon＋label＋時間；不以顏色獨立表意 |
| ProductCard／ModifierGroup | QR menu與既有modifier資料契約 | 必選、上下限、售罄、差額、提交error |
| PaymentStatus | 現有payment state／provider attempt | UNPAID、PAID、REFUNDED、PENDING_RECONCILIATION；未知先查 |
| PrintJobStatus | 既有print queue／capability | 排程／完成／失敗／待人工；不合併成付款狀態 |
| Empty／Error／Offline／Conflict | 既有提示元件先盤點後共用少量相同呈現 | 短說明＋明確恢復動作；非泛用重試 |
| Toast／Banner | 現有通知系統 | partial success不覆蓋原單狀態；error可持續讀取 |
| ResponsiveTable | 現有desktop table＋mobile cards組合 | 各欄位可到達；主動作不需橫滑尋找；保留sort/filter/page |

等效元件範例採現有測試fixture／本機頁面狀態，不新增展示產品或替代API。每個變動元件列 default、loading、disabled、focus、error、partial success；不适用須寫明理由。先修有來源與實测證據的差距，避免因規格清單而另造十多個同名wrapper。
