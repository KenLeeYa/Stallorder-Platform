# 多攤位方案與計價

## 資料來源

方案與權益只讀取資料庫 `plans/subscriptions`，前端不得硬編碼授權判斷。UI 顯示值、建立攤位 entitlement 與 invoice 計算都使用同一 plan record。

## 目前種子

| 方案 | Included stalls | 額外攤位/月 | Max stalls | Base fee | Included orders / Excess |
| --- | ---: | ---: | ---: | ---: | --- |
| Lite | 1 | 不開放 | 1 | 0（待商務設定） | 未設定 / 0 |
| Standard | 1 | NT$299 | 10 | 0（待商務設定） | 未設定 / 0 |
| Pro | 3 | NT$199 | 50 | 0（待商務設定） | 未設定 / 0 |
| Enterprise | 1（可調整） | 可設定 | 無固定上限 | 0（待報價） | 可設定 |

使用 0/NULL 是保守預設，不代表正式售價。正式收費前必須用 migration 或受控平台管理流程填入核准的 base fee、included orders、excess order price 與 Enterprise 合約值。

## 計算公式

```text
invoice total
= plan.base_price
+ approved additional stall quantity × approved unit_price
+ max(0, order usage - included_orders) × excess_order_price
+ feature add-ons
```

所有金額以最小幣別整數保存，TWD 不使用小數。

## 建立攤位 entitlement

API 在 transaction 內鎖定 organization subscription，依序檢查：

1. Subscription 存在且狀態可用。
2. 目前 active stall count。
3. Plan `max_stalls`。
4. `included_stalls`。
5. 尚未到期、狀態 APPROVED 的 additional stall quantity。

超過 included 但未取得核准時回 `ADDITIONAL_STALL_APPROVAL_REQUIRED`；超過 max 時回 `PLAN_STALL_LIMIT`。鎖定可避免平行請求同時越過上限。

## 人工核准階段

Platform admin 可核准額外攤位數量、unit price、生效/到期日。流程會：

- 建立 `additional_stall_approvals`。
- 對該帳期 upsert invoice。
- 新增額外攤位 invoice line item。
- 更新 invoice subtotal/total。
- 寫入 before/after audit。

撤銷/到期核准後不能再用於建立新攤位；既有 active stall 不會自動刪除，需依合約進入 grace/人工處理。

## Usage metering

目前事件：

- `ORDER_CREATED`
- `STALL_ACTIVATED` / `STALL_DEACTIVATED`
- `STAFF_MEMBERSHIP_CHANGED`
- `QR_CODE_CREATED`
- `CSV_EXPORTED`

訂單、攤位、QR 與 membership 由 database trigger 記錄；CSV 由 trusted API 記錄。`reference_id` 去重，active member 彙總必須把 organization/stall memberships 的變動量整合後再計算。

## UI 與權限

- Owner：查看方案、用量、invoice，管理 subscription。
- Finance：唯讀查看財務/用量與匯出授權報表。
- Org Admin、Staff、Kitchen：不能修改 subscription。
- Platform admin：核准額外攤位與記錄費用。

## 對帳

每帳期至少比對：active stalls、有效核准數、訂單 usage、staff count、QR count、CSV exports、invoice line item 合計與 invoice total。差異必須用 append-only 修正事件或受稽核管理操作處理，不直接覆寫歷史 usage。
