# Phase 3 帳務路線圖（未啟用）

## 候選能力

- Coupon、promotion code、方案折扣與 credit ledger。
- Proration、期中升降級、usage-based invoice。
- Customer billing portal、自動催收與多 Provider failover。
- MRR、ARR、ARPU、churn、LTV 與 cohort 指標。
- Enterprise contract、reseller、partner commission、white label、多法律實體。

## 設計前提

- 不回寫既有 Plan Version；合約價格與權益以新版本或 Enterprise contract snapshot 保存。
- Money calculation 使用整數與明確 rounding policy，credit／discount 採不可變 ledger。
- Proration 需先定義時區、帳期邊界、稅額、取消與退款順序。
- Analytics 與授權資料分離；報表不得成為 feature access 的權威來源。
- Provider failover 不得重複扣款，需全域 payment intent idempotency 與人工 reconciliation。

## 啟用順序

1. 定義會計、稅務、退款與合約規則。
2. 建立 immutable ledger、contract snapshot 與可重算 analytics projection。
3. 以歷史匿名資料驗證 MRR／ARR／churn 定義。
4. 完成跨 Provider duplicate charge、partial refund 與 outage chaos test。
5. 以獨立 flags 漸進啟用，不將 Phase 3 flag 綁成單一總開關。

## 目前狀態

所有 Phase 3 flags 均為 false；Phase 1 不包含自動商業計算、customer billing portal、reseller 或 partner payout。

