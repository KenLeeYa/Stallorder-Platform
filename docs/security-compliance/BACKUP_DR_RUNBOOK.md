# 備份、DR及治理回復
本次沒有修改另一個DR checkout或遠端Apply。COMPLIANCE_ENABLED預設false；新表及erasure欄位僅在本機lab。

複寫分類：privacy policy/request/event/export/hold/task/tombstone、retention policy、support grant、incident、audit archive outbox。環境本地：security_step_up_grants，避免另一backend重用敏感授權；既有backend_runtime_state/health維持本地。scripts/lib/dr-replication-scope.mjs變更未對遠端publication執行。

日後先DR compatible expand、再Primary expand、publication/column refresh、initial copy/replica identity/sequence/lag；最後才考慮flag。需main/staging相同tree、fresh Plan、正確project/alias/backend及verified recovery artifact。舊Plan不涵蓋新tree。

專屬lab stallorder-compliance-20260913：DB55992、API55991、mail55994；6個容器，僅合成資料。完成後只停本次label的容器，不刪data/volume/image，不停其他task。SERVICE_RECEIPT.json為實際狀態。重啟先核label/port/consumer，start既有容器且DB/API健康；不得從來源預設supabase config誤啟共用project。

隔離restore程序：
1. 固定備份時間/hash/DB識別、物件manifest、Auth設定、key版本、撤銷與刪除清單，取得獨立較新證據。
2. 無真實外送/付款/通知/印單憑證、受控egress、worker關閉。
3. 還原DB，分別還原Storage/Auth/flags/DDL/sequence；logical replication不自動涵蓋這些。
4. 重套tombstone及session/device/key/support/step-up撤銷，重查purpose/hold，queue維持停用。
5. 比對order/payment/refund/PAYG/stock/invoice數量金額、狀態/冪等鍵，再跑cross-tenant與stale writer拒絕。
6. 只有授權owner核准健康及證據後開流量。舊Primary無法證實fence時人工隔離，不能因看不到就開第二writer。

沿用PRODUCTION_FAILOVER_RUNBOOK/PRODUCTION_FAILBACK_RUNBOOK；先保留DR唯一writer、補回DR期資料、對帳、seal、增加epoch再回切。實際DB＋files＋Auth演練及跨區RTO/RPO尚待證據，本機結果非Production SLA。


本次實際證據：第二個乾淨lab `stallorder-compliance-regression-2026091` 在55982從頭套用151個migration，75組pgTAP全部通過。`privacy_restore`為第一個lab的獨立資料庫；pg_dump/pg_restore含合成資料、排除pg_cron/cron；11筆訂單與總額1905、4個tombstone及1筆已移除聯絡資料保留。`verify-isolated-restore.mjs`實際撤銷應用session/step-up/support/offline並停printer，未刪訂單或改金額。詳見restore-receipt.json；這不是Storage object、provider Auth、較新獨立撤銷feed或RPO/RTO證明。兩個lab共8個容器由本次啟動，結束逐label停用。
