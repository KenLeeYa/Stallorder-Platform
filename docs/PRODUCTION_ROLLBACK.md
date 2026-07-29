# Production Rollback 與災難復原

核心原則：先止血、保留證據、避免資料破壞。Database schema 優先 forward-fix；沒有已驗證備份與事故指揮核准，不做 destructive rollback。

韌性功能發生回歸時，先透過受稽核的 server-side feature flag 停止 rollout，
再判斷是否回滾 Vercel deployment。不得只改前端開關，也不得以
`BACKEND_ACTIVE_TARGET=DR` 單獨啟用 DR。

## 立即止血

1. 由 merchant emergency controls 將受影響 stall `ordering_state=PAUSED` 或 `CLOSED`、`ordering_enabled=false`。
2. 大範圍事故可暫停全部 QR；必要時 revoke／rotate 特定 QR。
3. 保留已成立訂單，staff 以只讀／既有流程完成或人工聯絡，不匿名離線補寫。
4. 記錄開始時間、operator、影響範圍、deployment、database／Edge version 與 request ids。

## Vercel rollback

- 從 Vercel deployment history 選擇最近已通過 smoke test 的 commit，使用 Dashboard rollback 或 `vercel rollback <deployment>`。
- Rollback 後重新確認 Production variables scope、`/api/health`、security headers、login 與 public QR 負向測試。
- 不用重新 build 的未驗證來源取代已知良好 artifact。

## Edge Function rollback

- 從 Git tag／commit 取回最近已驗證版本，重新部署三個 Function；不要只在 Dashboard 臨時改 code。
- 保持 Production secrets，不將值匯出；若事故涉及 secret，先 rotate 再部署。
- 檢查 Function logs、Turnstile、session replay、idempotency 與 CORS。

## Database migration

- Schema migration 失敗時停止應用 promotion，保留 migration history 與錯誤 log。
- 可相容問題以新 migration forward-fix；先在隔離 restore／Staging 驗證，再套 Production。
- 不手動刪 table／column、不執行 `db reset`、不任意 `migration repair`。
- 只有資料毀損且 forward-fix 不可行時，才由事故指揮決定 point-in-time／platform restore；先確認 RPO、受影響寫入與 restore rehearsal。

## DNS rollback

- 依變更前匯出的 GoDaddy 記錄還原受影響的 A／CNAME／TXT；保留 MX/SPF/DKIM/DMARC。
- 不改 nameserver。考量 TTL／propagation，並持續監控舊、新端點與 TLS。
- DNS rollback 不取代 Vercel deployment rollback；兩者狀態需分別驗證。

## Turnstile incident

- 暫停 public ordering，rotate Cloudflare secret，更新 Supabase Production secret，確認 `TURNSTILE_ALLOW_TEST_KEYS=false`。
- 重跑 valid／invalid／expired／replayed／wrong-hostname tests，檢查 attempt logs，再逐攤恢復。

## 備份與復原

- 使用 Supabase platform backup、每週 logical backup、Storage object backup。
- 每季至少在隔離專案 restore test，驗證 migration history、RLS、Auth mapping、Storage reference、Cron 與 Edge compatibility。
- USER ACTION REQUIRED：正式上線前核准 RPO、RTO、事故聯絡樹與可執行 restore 的人員名單。

## 恢復服務

完成 root cause、修正驗證、RLS／smoke／monitoring、積壓訂單處理與 stakeholder 核准後，先單一測試攤位，再分批恢復 ordering。事故報告不得包含 credentials 或顧客敏感資料。
