# KPI 字典

| 代碼 | 中文名稱 | 公式 | 粒度 | 來源 | 限制 |
| --- | --- | --- | --- | --- | --- |
| ORDER_ENTRY_AMOUNT | 訂單登記額 | Σ net_sales | 日／攤位／組織 | daily_stall_summaries | 非金流實際入帳 |
| ORDER_COUNT | 訂單數 | Σ order_count | 日／攤位／組織 | daily_stall_summaries | 含後續取消訂單 |
| COMPLETED_ORDER_COUNT | 完成訂單數 | Σ completed_order_count | 日／攤位／組織 | daily_stall_summaries | 依 canonical status |
| AVERAGE_ORDER_VALUE | 平均完成訂單金額 | ORDER_ENTRY_AMOUNT ÷ COMPLETED_ORDER_COUNT | 期間／組織 | daily_stall_summaries | 分母 0 時為 0 |
| CANCELLATION_RATE | 取消率 | cancelled_order_count ÷ order_count | 期間／組織 | daily_stall_summaries | 不代表退款率 |
| DISCOUNT_RATE | 折扣率 | discount_amount ÷ gross_sales | 期間／組織 | daily_stall_summaries | gross 0 時為 0 |
| EVENT_ATTRIBUTED_REVENUE | 活動估算歸因額 | Σ estimated_revenue_amount | 活動／campaign | event_growth_order_attributions | 目前 capture OFF；必須顯示模型與信心 |
| SUPPLY_ON_HAND | 現有庫存 | balance.quantity_micros | 食材／庫位 | supply_inventory_balances | 依盤點與異動時效 |

每次修改公式、來源或 business definition 都需版本審查、回歸測試與報表註記；不可用 AI 或猜測補齊缺少資料。
