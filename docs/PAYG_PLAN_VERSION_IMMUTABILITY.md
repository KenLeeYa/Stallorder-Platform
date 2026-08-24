# PAYG PlanVersion Immutability

新 PAYG 版本在封存前可組合價格、cap、時區、稅務與 entitlement snapshot。封存動作必須在同一 transaction：

1. 複製指定來源版本與 entitlements。
2. 正規化契約欄位並依 feature code 排序 entitlement。
3. 計算 SHA-256 `contract_hash`。
4. 寫入 `sealed_at`、`sealed_by_profile_id` 與 audit before/after。

封存後，或已有 Subscription／Invoice 使用後，價格、cap、稅務、時區及 entitlement insert/update/delete 全部由資料庫 trigger 拒絕。任何變更都必須建立下一個版本，歷史 Invoice 只認原 `contract_hash` 與 snapshot。
