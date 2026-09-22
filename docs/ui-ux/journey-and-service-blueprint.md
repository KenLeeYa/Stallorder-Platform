# 服務流程與失敗復原

| 階段 | 使用者看到／操作 | 既有權威服務與結果 | 失敗／回復規則 |
|---|---|---|---|
| 進入點餐 | Menu、QR、外帶／外送模式與營業限制 | public session、availability、供應時間與日期、QR token | 關店／維護不能建新單；保留購物車，重新檢查 |
| 選餐 | 品名、價格、必選／多選、餐具 | product-note-selection、bundle selection、server repricing | 必選未完成、售完／庫存不足明示；不丟棄其他項目 |
| 結帳資料 | 稱呼／電話／地址、時間、合計 | QrOrderCartPanel → qr-order-checkout-controller | 錯誤與欄位群組關聯；連點與結果未知沿用 clientOrderId／operationId |
| 成立與追蹤 | 原訂單編號、付款、進度、修改入口 | public-order-client／server order、tracking token | 未確認才按 server 規則修改；不可因 timeout 重建整筆訂單 |
| 接單 | 待接單篩選、品項明細、允許操作 | StaffOrderBoard controller、RBAC、canTransitionOrder | 權限／版本／營業時段重新驗證；不從篩選類別推斷可操作 |
| 製作 | 製作中清單、item status、備註 | KDS 與 item transition | 批次只處理允許的選項；部分成功保留未完成項 |
| 列印 | 列印工作／問題入口 | primary-print-status、原票／重印／改單 family | 原票成功不被備份票失敗覆蓋；修改單仍需各自處理；不重收款 |
| 收款與交付 | 待交付／結帳、付款狀態、合法 CTA | payment、pickup、checkout lifecycle、terminal reconciliation | PAID 不代表已交付，READY 不代表已付款；未知結果先查詢 |
| 日常管理 | 商品分頁、供應模式／庫存 | merchant products PATCH、stock version、營業日界線 | 今日售完／定時恢復不補回可售份數；永久下架需手動恢復 |
| 統計與維運 | 日期區間、門市、generatedAt、警示 | multi-stall-dashboard、reports、audit、admin health | 不把缺資料當 0；不新增假的即時指標；敏感健康資訊保留權限 |

## 狀態交叉

UI 篩選是 read model：WAITING_CONFIRMATION → 待接單；CONFIRMED/PREPARING/PACKING → 製作流程；READY → 待交付／結帳。列印待處理與製作狀態可重疊，只根據 primary FAILED/CANCELLED 判定，不把 PENDING/PRINTING 當失敗。

此設計不新增 OrderStatus、PaymentStatus、PrintJobStatus 或資料表，不改變既有時間協商、預約、折扣、退款、列印重試、會員／LINE 通知規則。
