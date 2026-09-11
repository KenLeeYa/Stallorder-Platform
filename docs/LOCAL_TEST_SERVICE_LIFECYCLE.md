# 本機測試服務：按需啟用、測試後停止

2026-09-10 起依使用者要求執行。這是本機開發服務管理規則，不涉及正式環境。

## 固定作業規則

1. 測試前先核對 Docker/Supabase project label、API/DB 連接埠、實際啟動的 worktree 與執行中的任務，僅啟用本次所需的環境。容器健康或低 CPU 不等於有使用者正在測試。
2. 測試結束後，預設停止本次啟用的 Docker 與開發服務；保留測試資料、容器、映像及 volumes。若另有執行中任務依賴，或使用者明確要求保留人工 QA，記錄例外、用途與連接埠，待使用結束再停。
3. 不使用 `docker system prune`、`docker volume prune`、`docker compose down -v`、Supabase reset 或刪除 WSL 資料來節省記憶體。也不為了只停一組環境而關閉仍有其他工作使用的 Docker Desktop。
4. Docker Desktop 曾整體停止時，下次啟動可能自動恢復原本運行的容器。啟動後必須依當次核准的 project 清單重新核對，停止未使用的舊環境；不要把「引擎已關閉」當成逐容器停用已完成。
5. 交接時列出保留／停止的 project、前端/API/DB ports、容器健康與資料保留狀態。重新啟用後確認 DB/API 與前端健康，再執行本次所需的流程測試。

## 2026-09-10 盤點

2026-09-11 人工 QA 例外：使用者要求啟用勾選介面版本供測試；目前另保留 `Stallorder-Platform-order-selection-checkboxes-20260911` 的 3018 與 `stallorder-catalog-ops-20260907` 的 DB 55722（僅 DB 容器，其他 7 個仍停止）。兩組供應鏈及其他工作區既有服務未異動。實際工作樹、啟動方式、停止程序與驗證見 [本機快速登入](LOCAL_QA_QUICK_LOGIN_20260911.md)。測試結束後停止本次服務並保留資料。

停止前 Docker Engine 29.7.2，共 45 個運行容器：44 個屬於 StallOrder 五組 Supabase 環境，另 1 個為 Jarvis 資料庫。以下使用判斷來自實際程序、連接埠、工作區設定及任務狀態，非依歷史文件推測。

| Supabase project / 容器 | 容器數 | 前端 | API / DB | 停止前使用情形 | 本次使用者選擇 |
| --- | ---: | --- | --- | --- | --- |
| `stallorder-supply-runtime-20260903` | 11 | 3110 / 3111 | 55441 / 55442 | 買方與供應商程序運行，瀏覽器連線存在；Supplier Portal WMS 任務仍在執行 | 恢復、保留供應鏈測試 |
| `stallorder-omo-scm-completion-20260909` | 6 | 3120 / 3121 | 56441 / 56442 | OMO SCM 買方／供應商開發程序運行，工作區設定明確指向此組 | 恢復、保留供應鏈測試 |
| `stallorder-platform` | 12 | 未找到使用中的前端 | 54321 / 54322 | 舊共用主測試環境，未找到對應前端或測試程序 | 停止 |
| `stallorder-customer-order-hotfix-2026090` | 7 | 原修復測試環境 | 55621 / 55622 | 未找到使用中的前端或測試程序 | 停止 |
| `stallorder-catalog-ops-20260907` | 8 | 3018（盤點時未運行） | 55721 / 55722 | 本次介面修正測試已結束，未找到使用中的前端或測試程序 | 停止；下次介面測試才啟用 |
| `ky-jarvis-postgres-1` | 1 | 其他專案 | DB 55433 | 不屬於 StallOrder | 維持停止，未刪除資料 |

服務組成：

- 供應鏈 55441 組：PostgreSQL、Kong API gateway、Auth、PostgREST、Realtime、Storage、Studio、PG Meta、Inbucket、Analytics；Vector 因 Docker log source 連線遭拒而反覆重啟，本次先停止，恢復後實際運行 10 個容器。需要驗證日誌收集時再修復其連線並啟用，不把日誌收集標記為已恢復。
- OMO SCM 56441 組：PostgreSQL、Kong API gateway、Auth、PostgREST、Realtime、Storage。
- 舊主環境：供應鏈 55441 組相同的 11 種服務，另有 Edge Runtime。
- 顧客修復組：PostgreSQL、Kong、Auth、PostgREST、Realtime、Storage、Inbucket。
- 商品／介面組：顧客修復組相同的 7 種服務，另有 Edge Runtime。

盤點過程曾觀察到 Docker Desktop 在本次尚未執行停止指令前已整體停止；原因未經確認。使用者隨後明確選擇「恢復兩組供應鏈，其餘保持停止」。最終操作與驗證記錄見下節。

## 停止與再啟用

先查看實際 label 與名稱，避免在錯誤的 worktree 執行共用設定：

```powershell
docker ps --format '{{.Names}} | {{.Ports}}'
docker stats --no-stream
```

以明確 Supabase project 為單位停止，容器及資料均保留。以下只示範已結束的介面測試環境，其他 project 必須先重新核對使用情形：

```powershell
$testProject = 'stallorder-catalog-ops-20260907'
$testContainers = @(docker ps -q --filter "label=com.supabase.cli.project=$testProject")
if ($LASTEXITCODE -ne 0) { throw 'Docker 無法查詢；停止操作未執行' }
if ($testContainers.Count -gt 0) {
  docker stop --timeout 30 $testContainers
  if ($LASTEXITCODE -ne 0) { throw '請核對實際容器狀態，不能宣稱已全部停止' }
}
docker ps -a --filter "label=com.supabase.cli.project=$testProject" --format '{{.Names}} | {{.Status}}'
```

需要測試時，先確認 Docker Engine 已運行，啟動該 project 的既有 DB 容器，確認 healthy，再啟動同 project 的其他容器；不要重建或重設測試資料。若使用 `supabase start`，必須驗證其 `--workdir` 下的 `supabase/config.toml` project_id 與 ports，不能直接從來源工作區啟動：目前多個來源 worktree 的設定仍寫 `stallorder-platform`，實際測試環境卻是獨立 project。

供應鏈前端對照：

- `Stallorder-Platform-supply-network-20260902`：`SUPPLY_NETWORK_LOCAL_PORT_SET=omo`，3110／3111，DB 55442。
- `Stallorder-Platform-omo-scm-completion-20260909`：`SUPPLY_NETWORK_LOCAL_PORT_SET=omo-scm`，3120／3121，DB 56442。
- 介面修正 `Stallorder-Platform-toggle-utensils-20260909`：3018，DB 55722；Edge 專用環境為 `.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/toggle-utensils-edge-lab-20260909`，其 project_id 才是 `stallorder-catalog-ops-20260907`。

## 最終驗證記錄

2026-09-10 00:20（台灣時間）核對：

- Docker Engine 29.7.2 已恢復；目前只有兩組核准的供應鏈 project 運行，共 16 個容器（55441 組 10 個、56441 組 6 個），没有其他 project 或反覆重啟的容器。
- 三組未使用的 StallOrder 環境已停止；Jarvis 維持停止。最初 45 個運行容器降為 16 個。本次逐一停止了重新啟動後恢復的 26 個非保留容器，再停止 1 個異常 Vector；原先兩個 Edge Runtime 在引擎停止後已是 exited，沒有重新啟用。
- 所有現存 60 個容器的識別及掛載內容均保留，50 個 volumes 前後清單一致。掛載比對按 destination 排序，避免 `docker inspect` 回傳順序變動造成誤報。本次未刪除容器、映像、測試資料或 volumes。
- 16 個運行容器中，14 個提供 Docker healthcheck 且全部 healthy；兩個 PostgREST 沒有配置 Docker healthcheck，兩組 API 與 DB 另以實際请求驗證。
- 兩組 PostgreSQL `select 1` 通過。四個正式配置的本機 origin：`http://127.0.0.1:3110`、`http://localhost:3111`、`http://127.0.0.1:3120`、`http://localhost:3121` 的 `/api/health` 全部 HTTP 200、`status=ok`、`health=HEALTHY`。供應商 origin 是 `localhost`；用 `127.0.0.1` 替代會被原本的本機 origin 檢查拒絕，不應修改安全設定繞過。
- Engine 恢復曾被兩個殘留 AF_UNIX socket 擋住。僅隔離已停止 backend 的暫存通訊目錄並保留備份後成功啟動，未重裝或重設 Docker。詳見 [Docker 本機復原](LOCAL_DOCKER_DESKTOP_RECOVERY.md)。
- 唯讀快照與驗證收據位於 `C:\Users\KY\.codex\visualizations\2026\09\06\01a0761b-0cdb-73e1-82cc-59a3e93d5d66\docker-service-audit-20260910`；包含 `before-selective-stop.json`、`selective-stop-result.json`、`final-containers.json`、`final-verification.json` 與 volumes 清單，未保存密鑰或容器 environment。

本次是服務恢復與資源整理，未重跑供應鏈完整交易驗收，未更改開發中的供應鏈程式。使用者明確要求保留的兩組服務，在供應鏈測試結束後仍須依固定規則停止。

## 2026-09-11 商品供應／訂單變更手動 QA 保留例外

使用者要求本機測試與保留範例資料；本次驗收後保留以下最小服務：

- 3018：`Stallorder-Platform-order-selection-checkboxes-20260911`，分支 `codex/catalog-availability-amendments-20260911`，提供四個快速登入按鈕。
- 55722：`supabase_db_stallorder-catalog-ops-20260907`，容器 `59f8e85233fa`，healthy。此 project 其餘七個容器保持停止；55721 / Edge / Realtime 未啟動，本機公共流程走 Circuit B。
- 兩組供應鏈仍有原本 16 個容器，另有他工作區 `kuanguard-db-1`；本次未操作這些服務。

已套用兩份商品供應／變更單 migration，保留測試商品與訂單。新功能及最新範例請見 [驗收記錄](CATALOG_AVAILABILITY_AND_ORDER_AMENDMENTS_20260911.md)。留存範例超過原容量門檻，本機已改為 100 單／300 份，自動暫停／恢復不變；原值 20／60 保存在收據，可於容量頁還原。

啟停入口及收據：

- `C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/quick-login-environment-20260911/start-local-qa.mjs`：載入已驗證的本機環境，啟動工作區的 `scripts/start-local-qa.mjs --port 3018`。用 `Start-Process -WindowStyle Hidden` 啟動，避免彈出額外終端視窗。
- 同目錄 `server-process.json` 記錄當次 launcher／runtime PID、工作區和連接埠。停止前必須讀回當下 3018 的 owner、父子程序及命令列，僅停止這棵開發程序；PID 會改變，不沿用舊文件中的 PID。
- 停止前確認 DB 沒有其他活躍任務，再 `docker stop --timeout 30 supabase_db_stallorder-catalog-ops-20260907`；只停止，不刪資料。
- 下次需要時核對容器 label 後 `docker start supabase_db_stallorder-catalog-ops-20260907`，等 healthy 再啟動上述 launcher。不啟動整組不需要的 Supabase 容器。

此次為使用者待進行的手動 QA 例外；使用者確認測試結束後應停止 3018 與本組 DB，需要時再恢復。
