# 資料遷移計畫

## 新增式 migration

| Migration | 內容 | 回滾策略 |
| --- | --- | --- |
| `20260826130000_competitive_module_channel_catalog.sql` | 菜單版本、項目、通路覆寫、發布 | 關閉 HQ flag；保留資料 |
| `20260826133000_supply_lite_foundation.sql` | 食材、庫位、配方、餘額、ledger | 關閉 Supply flag；停止寫入 |
| `20260826140000_developer_platform_foundation.sql` | API client、Webhook endpoint/delivery | 撤銷 key、停用 endpoint |
| `20260826150000_growth_foundation.sql` | Coupon、stamp、referral、RFM、automation | 關閉 Growth/CRM flags |
| `20260826160000_event_growth_foundation.sql` | Campaign、touchpoint、attribution、expense、snapshot | 關閉 Event flag；capture 保持 OFF |
| `20260826170000_daily_pickup_code_allocation.sql` | 當日三碼取餐驗證碼配置、重複防護與安全重用 | 停止配置新碼；保留既有訂單驗證資料 |
| `20260826180000_prepare_reorder_print_job_access.sql` | 訂單修改前 server-only 列印狀態安全檢查 | 停用修改入口；保留函式供舊 application 相容 |

## 執行順序

1. 在乾淨 Staging commit 產生 immutable Plan。
2. 驗證 additive-only、migration digest、RLS、grants 與 backend guard。
3. 在 DR/Staging Apply 後執行 schema smoke 與資料完整性檢查。
4. 建立綁定相同 commit/tree 的 Production Plan，依本次發布授權核准後 Apply。
5. 只逐組織開啟 Feature flag；觀察錯誤率、延遲與 backlog。

本文件描述執行順序，不可替代 fresh Plan digest、來源 commit/tree、DR Apply 前置證據與發布回合授權。
