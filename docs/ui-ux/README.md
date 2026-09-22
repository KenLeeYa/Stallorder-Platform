# StallOrder UI/UX 改造驗收入口

本輪以正式來源基準 `5cc15c6` 建立獨立分支 `codex/ui-ux-redesign-20260923`。完成優先介面的本機實作與 QA，**尚未正式上線**。原本工作樹及測試資料保留。

- [Phase 00–15 交付對照及明確缺口](phase-delivery-map.md)
- [實際命令、通過／略過／未驗證及效能](verification-report.md)
- [無障礙與實機驗收邊界](accessibility-report.md)
- [問題清單與後續優先順序](issues-backlog.md)
- [發布、設定與回復](release-and-rollback-plan.md)
- [真實程式碼盤點](current-state-audit.md)、[路由／權限](route-inventory.md)
- [官方參考](benchmark-matrix.md)、[角色](personas-and-jobs.md)、[服務流程](journey-and-service-blueprint.md)
- [資訊架構](information-architecture.md)、[設計系統](design-system.md)、[設計決策](design-decisions.md)

## 真實畫面

完整五頁 × 七寬度的可切換對照：

[本機前後對照頁](<C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/ui-ux-redesign-20260923/comparison.html>)

| 畫面 | 基準 | 改造後 |
|---|---|---|
| 店員桌面 1280 | [前](screenshots/before-staff-1280.png) | [後](screenshots/after-staff-1280.png) |
| 店員平板 768 | [前](screenshots/before-staff-768.png) | [後](screenshots/after-staff-768.png) |
| 共用商品 | [前](screenshots/before-catalog-1280.png) | [後](screenshots/after-catalog-1280.png) |
| 商家儀表板 | [前](screenshots/before-dashboard-1280.png) | [後](screenshots/after-dashboard-1280.png) |
| 平台帳務 | [前](screenshots/before-admin-1280.png) | [後](screenshots/after-admin-1280.png) |

## 本機測試服務

測試已結束，3023／3024 與本次 DB 55722 已停止。其他工作區的 StudyMesh、KuanGuard 容器未動。容器、volume、232 筆訂單保留；DB 經重啟讀回後正常關閉。詳見本輪 `service-stop-receipt.json`。

需要手動測試時，在確認沒有其他工作共用 55722 後，只開這一組：

```powershell
docker start supabase_db_stallorder-catalog-ops-20260907
docker exec supabase_db_stallorder-catalog-ops-20260907 pg_isready -U postgres
Set-Location 'C:/Users/KY/Documents/Codex projects/Stallorder-Platform-ui-ux-redesign-20260923'
$env:NODE_OPTIONS='--max-old-space-size=4096'
npm run dev:qa -- --port 3023
```

等待 DB accepting connections 與 App READY，開啟 `http://127.0.0.1:3023/login`，使用既有本機角色按鈕。示範攤位 `aming-chicken` 已保留新工作台 STALL 旗標，其他攤位預設使用原清單；啟閉驗證為 `UI_UX_QA=true` 下的 `e2e/ui-ux-rollout-local.spec.ts`。此處是 Node Circuit B 本機 QA；Edge 55721、第三方 provider 與硬體未啟動。

測完先在 app 終端 Ctrl+C，再停止同一 DB。本次 Docker stop 首次超時；已核對資料後使用容器內 `pg_ctl -D /var/lib/postgresql/data -m fast -w -t 30 stop` 完成正常 shutdown。容器會隨 PostgreSQL 結束，需以 Docker exited／exit 0 與 `database system is shut down` 日誌確認，不能只用 docker exec 退出碼判斷。不要 prune、reset 或刪除 volumes。
