# 多攤位後續 GitHub Issues

下列項目不阻擋目前多攤位初版功能，但應在正式收費或規模成長前追蹤。建立 GitHub issue 時使用相同標題與 acceptance criteria，且不得附上 production secrets/log raw token。

## P0：完成 production Google OAuth 驗收

範圍：設定 Google Cloud/Supabase 正式憑證、Site URL、redirect allow list，從邀請連結完成真實 Google 同意頁、callback、Email match、一次性接受與登出。

完成條件：staging/production smoke test 有 request ID；錯誤 callback 不建立應用 session；文件與值班 runbook 已驗證。

## P0：核准正式方案底價與超額訂單計價

範圍：決定 Lite/Standard/Pro base fee、included orders、excess order price 及 Enterprise 合約欄位，以 migration/受稽核管理流程更新，禁止直接手動 SQL。

完成條件：billing unit tests 使用核准值；invoice 對帳通過；UI 明確顯示幣別/帳期；0/NULL 不會被誤收費。

## P1：建立 modifier organization master 與 per-stall assignment

範圍：設計 modifier groups/items/product mapping 的 organization + stall scope，遷移現有資料並保留 order item modifier snapshots。

完成條件：migration/rollback notes、RLS/constraint/index、跨攤 assignment、價格覆寫、歷史訂單不回算，以及 pgTAP/E2E。

## P1：自動化摘要重建與 usage/invoice 對帳

範圍：排程偵測 summary lag、usage 差異、invoice line mismatch，分批呼叫 service-only reconciliation，輸出可告警指標。

完成條件：可重跑、去重、日期/組織範圍上限、失敗告警、runbook、負載測試；不新增無必要 queue。

## P1：補齊 PAYMENT_MISMATCH、STALL_OFFLINE、NO_RECENT_ACTIVITY 偵測

範圍：為已預留的 alert types 定義可靠訊號、threshold、解除條件與 false-positive 策略。

完成條件：SQL/worker 有 tenant scope、unique open alert、ack/resolve、RLS 測試及監控圖表。

## P2：多攤位負載與 Realtime 容量測試

範圍：50 攤/組織、尖峰 QR session、Dashboard 93 天、organization Realtime fan-out、SSE fallback、CSV export。

完成條件：定義 P95/錯誤率目標、驗證索引、無 N+1/未篩選訂閱、提出有數據支持的 partition/retention 調整。

## P2：資料保存與隱私自助流程

範圍：依商戶合約/法規落實 audit/public attempt/operational event 保存期、商戶資料匯出與刪除工作流。

完成條件：legal 核准、service-only job、稽核證據、備份/PITR 影響說明及 RLS 測試。
