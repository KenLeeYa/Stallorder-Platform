# Supply Lite 架構

## 範圍

- 食材與基本單位。
- 中央／攤位庫位。
- 商品配方與耗損比例。
- 收貨、耗用、調整、盤點、移轉與沖銷 ledger。
- 庫存餘額與移動平均成本。

## 一致性

- `supply_inventory_movements` 為不可變 ledger。
- `organization_id + idempotency_key` 唯一。
- 異動在 transaction 與 advisory lock 內更新 balance。
- 庫存不足不會被靜默修正；需明確規則或人工調整。

## 非目標

不做採購審批、應付帳款、供應商結算或大型 ERP；ERP 只預留可驗證的匯出／匯入 Adapter。
