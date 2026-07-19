# Invoice 與付款資料模型

## 金額規則

- 幣別預設 `TWD`，金額以整數元儲存，不使用浮點數。
- `total_amount = subtotal + tax_amount - discount_amount`。
- `amount_due = total_amount - amount_paid`，不得為負數。
- Invoice 開立前由伺服器從 Plan Version、Subscription Item 與受控 line item 重算。
- Invoice number 由資料庫序列產生，例如 `SO-202607-000001`，不以資料列數推算。

## 狀態

| 實體 | 狀態 |
| --- | --- |
| Invoice | `DRAFT`, `OPEN`, `PAID`, `VOID`, `OVERDUE`, `CANCELLED` |
| Manual Payment | `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `VOIDED` |
| Future Payment Attempt | `CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `REFUNDED` |

只有受信任的 `BillingWorkflowService` 可轉換狀態。瀏覽器 redirect 或客戶端聲明永遠不是付款證明。

## Phase 1 付款

- 支援 `BANK_TRANSFER`, `CASH`, `LINE_PAY_MANUAL`, `OTHER`。
- 商家提交付款紀錄時必須提供 organization-scoped idempotency key。
- Admin 驗證時鎖定付款、Invoice 與 Subscription；重複驗證回傳既有結果。
- 累計驗證金額達總額後，Invoice 與 Subscription 在同一交易更新。
- 不保存完整銀行帳號、信用卡號、CVV、帳戶密碼或無保存政策的截圖。

## Line Item

可用類型包含基本方案、額外攤位、order package、add-on、自訂服務、credit 與 discount。每列保存 code、description、quantity、unit price、subtotal；metadata 不得放 secrets 或付款憑證。

## 未來相容資料

- `payment_provider_customers`：組織對 Provider customer ID。
- `payment_attempts`：Invoice 付款嘗試，複合外鍵強制組織一致。
- `billing_webhook_events`：只保存 SHA-256 payload hash 與 Provider event ID，不保存原始 payload。
- Provider transaction/event ID 具有唯一性，為未來 replay protection 基礎。

所有未來表目前為 `FORCE RLS`、service-only，且 Provider flags 關閉。

