# 廚房與取餐架構

本次不建立第二套 KDS，沿用既有：

- Order / OrderItem 狀態與 production task。
- Kitchen station、工作站指派與 KDS 設定。
- Pickup display token、隱私顯示與保留時間。
- 列印 routing、job、retry 與重新列印稽核。
- 容量、商品製餐權重、等候時間與暫停規則。

任何新通路訂單都必須先轉成 canonical Order，才能進入同一 KDS、取餐與報表流程；不得由 Provider UI 直接修改廚房狀態。
