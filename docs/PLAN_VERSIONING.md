# Plan Versioning

- `plans` 提供穩定 code；`plan_versions` 保存不可回溯修改的價格、週期、額度與生效區間。
- Subscription 必須指向明確 `plan_version_id`；已被使用的版本不得原地改價。
- 調價建立新版本，既有商家只有經受稽核的明確遷移才切換。
- Trial 從核准時間起算；申請送件不建立 Subscription，也不消耗試用天數。
- UI 不得以 `plan.code` 判斷授權，必須顯示 server 解析的 effective entitlements。
- `20260813090000_enable_pro_printer_entitlement.sql` 是受稽核的明確權益授予：所有 migration 執行時已存在的 PRO／ENTERPRISE 版本均包含 `PRINTER_INTEGRATION`，並保留既有 limit/config；攤位仍須自行選擇啟用。
- 之後新增的 PRO／ENTERPRISE 版本必須在該版本的 entitlement snapshot 明確寫入 `PRINTER_INTEGRATION`；不得假設歷史 migration 會涵蓋未來版本。
- TWD 金額使用 integer，不保存浮點金額。

完整方案與權益矩陣見 [PLAN_AND_ENTITLEMENT_MODEL.md](PLAN_AND_ENTITLEMENT_MODEL.md)。
