# 現金交班與短溢收

## 範圍

Phase 4 提供攤位層級的現金開班、現金收支、退款、關班盤點、短溢收複核與跨攤位財務報表。系統只把現金付款列入班次；LINE Pay、街口支付與其他非現金方式不影響現金應有金額。

## 操作入口

| 入口 | 用途 |
| --- | --- |
| `/staff/[stallSlug]/cash` | 店員開班、現金收支、退款、盤點與交班；店長可複核 |
| `/merchant/reports/cash-shifts` | 組織層級的現金班次與短溢收報表 |
| `/merchant/stalls/[stallId]/cash-shifts` | 導向指定攤位的現金班次報表 |

## 班次流程

```text
OPEN
  -> CLOSING
  -> CLOSED

CLOSING
  -> REVIEW_REQUIRED
  -> CLOSED

REVIEW_REQUIRED
  -> CLOSED
```

1. 店員輸入預備金開班，系統建立 `OPENING_FLOAT`。
2. 現金付款必須在同一資料庫交易中綁定目前的 `OPEN` 班次，並建立 `CASH_SALE`。
3. 非現金付款不得綁定現金班次。
4. 現金退款建立 `CASH_REFUND`；手動收入或支出必須填寫原因。
5. 關班時只接受實際盤點金額；應有金額由伺服器依不可變動的現金流水重新計算。
6. 短溢收為 `實際盤點 - 系統應有`。有差異的班次保留待複核狀態與營運警示。
7. 已關閉班次不可直接修改，只能由具複核權限者建立有原因的更正與複核紀錄。

## 金額計算

```text
系統應有 = 開班金額
         + 現金銷售
         - 現金退款
         + 現金收入
         - 現金支出
         + 更正金額

短溢收 = 實際盤點 - 系統應有
```

前端顯示的預估值不具信任性；API 與資料庫約束會重新驗證班次、付款方式、攤位範圍與金額。

## 權限

| 角色 | 查看 | 操作班次 | 複核短溢收 | 跨攤位報表 |
| --- | --- | --- | --- | --- |
| `ORGANIZATION_OWNER` | 是 | 是 | 是 | 是 |
| `ORGANIZATION_ADMIN` | 是 | 是 | 是 | 是 |
| `STALL_MANAGER` | 是 | 是 | 是 | 指派攤位 |
| `FINANCE_VIEWER` | 是 | 否 | 否 | 是，唯讀 |
| `STAFF` | 是 | 是 | 否 | 否 |
| `KITCHEN` | 否 | 否 | 否 | 否 |

所有 API 權限由伺服器端 RBAC 與功能 entitlement 驗證；資料表另以 RLS 限制組織及攤位範圍。`KITCHEN` 不會取得付款總額或現金班次資料。

## 稽核與警示

以下動作會記錄操作者、班次、攤位、前後狀態與必要原因：

- 開班與關班
- 現金收入、支出、退款與更正
- 核准、退回與要求調整
- 現金付款綁定班次

系統會建立 `CASH_SHIFT_NOT_CLOSED` 與 `CASH_OVER_SHORT` 營運警示。排程檢查具冪等性，不會重複建立同一未解決警示。

## 驗證

- 單元測試：`src/lib/cash-shifts.test.ts`
- RBAC 測試：`src/lib/rbac.test.ts`
- 資料庫及 RLS：`supabase/tests/database/cash_shift_reconciliation.test.sql`
- 完整操作流程：`e2e/cash-shift-reconciliation.spec.ts`
- 現有 POS 現金付款回歸：`e2e/staff-pos-line-delivery.spec.ts`
- 既有交班工具回歸：`e2e/p1-operational-tools.spec.ts`
