# 生產故障模式矩陣

日期：2026-07-29

## 對外行為

| 故障 | QR 菜單 | QR 新訂單 | 店員線上 | 離線 POS | 付款 | 操作指引 |
| --- | --- | --- | --- | --- | --- | --- |
| Realtime 中斷 | 可用 | 可用 | SSE／輪詢備援 | 可用 | 可用 | 顯示目前連線模式 |
| SSE 中斷 | 可用 | 可用 | Realtime／5 秒輪詢 | 可用 | 可用 | 顯示目前連線模式 |
| Supabase Edge 503 | 可用 | Circuit B 備援 | 可用 | 可用 | 可用 | 保留既有安全驗證 |
| Vercel Circuit B 503 | 可用 | Circuit A 繼續 | 可用 | 可用 | 可用 | 不重複送單 |
| Primary 被 fence | 最近菜單只讀 | 禁止 | 顯示降級 | 可用 | 現金／人工 | 請至櫃台點餐 |
| Primary 不可用、DR 未核准 | 最近菜單只讀 | 禁止 | 顯示不可用 | 可用 | 現金／人工 | 不自動 failover |
| DR 已核准 promotion | 可重新載入 | 新 session 後恢復 | 重新連線 | 同步至 DR | 依供應商狀態 | 驗證 promotion epoch |
| Primary 與 DR 皆不可用 | 最近菜單只讀 | 禁止 | 線上不可用 | 可用 | 現金／人工 | 保存 queue，禁止假成功 |
| 完整 DNS／CDN 中斷 | 新客無法載入 | 禁止 | 已安裝 PWA 可離線 | 可用 | 現金／人工 | 現場告示與人工接單 |
| Turnstile 不可用 | 可用 | 禁止公開送單 | 可用 | 可用 | 不適用 | 不移除 Turnstile |
| LINE Pay 不可用 | 可用 | 可用 | 可用 | 可用 | 街口／現金／人工 | 不阻止訂單 |
| 街口支付不可用 | 可用 | 可用 | 可用 | 可用 | LINE／現金／人工 | 不阻止訂單 |
| 兩個線上付款皆不可用 | 可用 | 可用 | 可用 | 可用 | 現金／人工 | 後續人工對帳 |
| Storage quota／上傳失敗 | 既有圖片可用 | 可用 | 可用 | 可用 | 可用 | 停止新圖片上傳 |
| Service Worker 版本落後 | 可用 | 依 availability | 可用 | 不刪除 pending queue | 可用 | 完成安全更新後重載 |

## 不可破壞的不變量

所有故障情境仍必須維持：

- RLS、RBAC、CSRF、Origin、Turnstile 與 rate limit。
- QR session 短效、一次成功、不可重播。
- Idempotency 只防重複，不取代其他防濫用控制。
- 價格、商品狀態與付款結果由可信後端決定。
- tenant/stall scope 由 session 與 membership 解析。
- Realtime、SSE 與 polling 只通知重新抓取，資料庫仍是權威來源。
- 離線人工付款不會自動成為供應商已確認付款。
- 任一不確定結果都不得顯示訂單或付款成功。

## 切換原則

1. 正常狀態只有 Primary 可寫。
2. DR 平時拒絕寫入。
3. Failover 必須先 fence Primary、確認 replication/RPO，再提升 DR。
4. 自動探針不能自行完成 promotion。
5. Failback 必須先停止新寫入、核對資料，再重建單向複寫。
6. Production 不執行破壞性故障注入；演練使用本機或隔離環境。

