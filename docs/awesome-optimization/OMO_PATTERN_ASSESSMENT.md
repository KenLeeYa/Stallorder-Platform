# OMO／供應鏈模式對照

2026-10-01，控制者文件。狀態 **REFERENCE_ONLY**；未安裝、複製或整合任何 ERPNext、Medusa、Saleor 程式碼，也未建立另一組主模型、帳本或服務。本文件是 Phase13 的概念對照，不能作為 AW-57／58 的執行測試證據。

本地依據為本輪真實來源盤點 `.superpowers/sdd/2026-10-01-awesome-optimization/audit-backend-events.md` 第6節（HEAD87230e2）；後續修改與共同驗證仍需綁定當時的未提交候選雜湊。外部文件於2026-10-01透過 AnySearch3.0.1 官方頁面擷取，未執行文件內的操作指示、回饋 POST 或帳號建立要求。

## 模式 → 本地對應 → 本輪差異 → 後續 Gate

| 參考與模式 | 已存在的 StallOrder 對應 | 本輪差異及取捨 | 後續 Gate |
| --- | --- | --- | --- |
| [ERPNext 庫存異動報表](https://docs.frappe.io/erpnext/stock-ledger)：從進出及移轉紀錄觀察數量、估值與來源單據 | `src/server/supply-lite/supply-service.ts` 的 movement／balance／lot、收貨 transaction、advisory locks、FEFO 與移動平均成本；Prisma 的 SupplyInventoryMovement／Balance／Lot | 保留食材實物帳本與既有收貨服務。商品可售份數／訂單預留量有不同意義，不能用庫存報表取代。當前 receivePurchase 直接建立 RECEIVED 採購記錄；完整 ASN、分批 PO、AP 三方核對未在本候選證實 | 後續若要求完整採購審批／AP，先核對其他分支的真實差異、帳務與收貨版本，再單獨設計及 QA；不能把別的 worktree 能力列為已整合 |
| [Medusa 工作流程](https://docs.medusajs.com/learn/fundamentals/workflows)：將跨系統操作拆成可追蹤步驟與補償 | 原訂單、付款、退款、履約狀態機、audit／outbox，以及既有 report_deliveries executor | 參考步驟邊界，修補現有 report claim／lease／送出前 fencing／固定快照／UNKNOWN 對帳；不引入 Medusa workflow SDK 或第二個 scheduler。provider 接受後遺失回應時，補償不能等同再次發訊或扣款 | 先完成 Batch4 的真實競爭、crash、最後一次嘗試及未知結果測試；只有現有 executor 的具體量測缺口才評估替換服務，需 drain／單一 owner／可證明的回復程序 |
| [Saleor 通路](https://docs.saleor.io/developer/channels/overview)：單一後端為不同通路提供可售性、價格與訂單存取脈絡 | 公開 QR、自有 POS、Staff 訂單與 ExternalOrder 的 `(connectionId,provider,externalOrderId)` 唯一對應，沿用 canonical orders | 不移植 Saleor 的 channel permission 模型。通路不是 StallOrder 租戶邊界；每個本地 API 仍需 Organization／Stall／permission 的 server 校驗。共用商品讀取仍須限制授權資料，不因外部產品共享模式而放寬權限 | 新外送／POS connector 需供應商正式授權、版本與去重／退款／履約合約；目前 mock／contract-only 狀態不能算正式 API 串接 |
| Provider module 的薄介接 | 既有 LINE、payment-providers/provider-registry、delivery 及 supplier module 邊界 | 只在既有 owner 後增加必要的型別與 mock／Noop adapter。各店收款仍獨立；通知、分析與供應採購不成為資金或 PAYG 帳本 | 各 provider 的帳號、測試憑證、目的地、權限、配額與真實接受／送達證據逐項列入外部設定清單；LINE sender 政策尚待先前已提出的釐清 |

## 帳本與權威邊界

- B2C 計費沿用 `src/server/billing/payg-pricing.ts`、versioned PAYG contract 與既有 billing events：每攤每月淨完成訂單 TWD1、1499上限。測試／canary 排除與 full-refund／late credit 規則保留。
- B2B 採購與食材 movement 不建立 `record_billable_order_completed` 事件、不修改已存在商品預留帳本、不由 notification／analytics 次數計費。
- 營收、實收、GMV、netSales、現金與平台費維持原報表語義；付款金額與完成狀態由原 server transaction 決定。
- 新 cache、搜尋、Inbox 與 Native DTO 都是讀取／操作介面；來源身分、資源 ID 或 client role 不提供額外權限。
- 本輪不建立配送員系統、貸款、第三方資金保管、完整供應商商城或第二套 ERP 商家／商品／會員主模型。

## 授權及來源使用

僅閱讀與概念對映，未取用外部 implementation、註冊服務、啟用免費試用或購買方案。未來若要複製程式碼或安裝 SDK，必須核對精確版本、來源、著作權、選定 edition 授權與相容性；本次參考不預先授權後續使用。官方文件中的代理操作提示與雲端宣傳屬來源內容，並非使用者指令。

保留的擷取證據：`.superpowers/sdd/2026-10-01-awesome-optimization/omo-reference/{erpnext-stock-ledger,medusa-workflows,saleor-channels}.txt`。擷取成功不代表本地功能測試或供應商整合成功。

## 驗證交接

| AW | 本輪已具備 | 必須完成的執行證據 | 狀態 |
| --- | --- | --- | --- |
| 56 | 三個模式的本地對應、差異及後續 Gate；不新增平行帳本的明確範圍 | 共同 diff／模型／依賴檢查與既有 Supply／Order／Billing regression | REFERENCE_ONLY／執行部分 NOT_RUN |
| 57 | 既有帳本、收貨及計費來源的真實 source 對照 | 唯一共享本機 DB 上的真實收貨 transaction：前後 billing events／商品預留數量不變、Supply movement／balance 正確、錯租戶遭拒；失敗 transaction 不產生部分副作用 | NOT_RUN |
| 58 | 原 MOCK／contract-only 邊界與外部未啟用限制 | 實際 adapter／功能旗標負例，未授權 connector 不發外送、支付或通知；provider status 分清接受／UNKNOWN／送達 | NOT_RUN |

沿用 `src/server/supply-lite/{supply-service,supply-contract,supply-management-safety.contract}.test.ts`、`supabase/tests/database/workforce_supply_tenant_integrity.test.sql` 與原 PAYG／order regression。既有測試名稱不等於此候選已 PASS；須由後續 QA owner 補上 transaction assertions、保存 current source／fixture／命令／exit／實際計數。所有測試統一使用保留的 responsive DB56822，無需另一個 Docker project。
