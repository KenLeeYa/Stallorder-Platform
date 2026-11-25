# Production Rollback 與災難復原

核心原則：先止血、保留證據、避免資料破壞。Database schema 優先 forward-fix；沒有已驗證備份與事故指揮核准，不做 destructive rollback。

事故分級、角色、前 15 分鐘與溝通方式見
[INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)；跨專案資料復原原則見
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)。

韌性功能發生回歸時，先透過受稽核的 server-side feature flag 停止 rollout，
再判斷是否回滾 Vercel deployment。不得只改前端開關，也不得以
`BACKEND_ACTIVE_TARGET=DR` 單獨啟用 DR。

## 立即止血

1. 由 merchant emergency controls 將受影響 stall `ordering_state=PAUSED` 或 `CLOSED`、`ordering_enabled=false`。
2. 大範圍事故可暫停全部 QR；必要時 revoke／rotate 特定 QR。
3. 保留已成立訂單，staff 以只讀／既有流程完成或人工聯絡，不匿名離線補寫。
4. 記錄開始時間、operator、影響範圍、deployment、database／Edge version 與 request ids。

## Vercel rollback

正式 Apply 45169140104 已切換至 `bdd968cf`。專用測試 QR 在最後點餐時間後回傳
`QR_LAST_ORDER_PASSED`。當次自動回復在 CLI 載入時結束，沒有切回舊版。
後續補驗使用 main 上的「Production QR recheck for batch one」，由專案負責人在
測試攤位開放點餐時啟動。流程在建立專用短效 session 前後，均核對實際正式版本與
Primary epoch 3。需確認 recheck 工作確實執行、26 項通過及 session HTTP 201。
原 Apply 收據保留失敗狀態，補驗 run 另行記錄。

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
## 雙路徑訂單快速回復

若新公開訂單 B 路徑出現異常：

1. 由平台管理員將 `DUAL_ORDER_INTAKE_ENABLED` 關閉並填寫原因。
2. 確認 `/api/availability/config` 回傳 `orderIntake=EDGE_PRIMARY`。
3. 確認直接呼叫 Circuit B 回傳 503 且沒有建立 session／order。
4. 監控既有 Supabase Edge Circuit A 的成功率、Turnstile 與限流。
5. 保留 migration；只有在所有新版流量停止後才評估移除向下相容 RPC。

關閉旗標不會停用既有 QR 點餐，也不會改變訂單狀態、價格計算、RLS、
Turnstile 或 idempotency。

## 已提升 DR 的回復限制

DR 成為 `ACTIVE_WRITER` 後，不得把 Vercel 變數直接切回 Primary，也不得解除
Primary fence。依 [PRODUCTION_FAILBACK_RUNBOOK.md](PRODUCTION_FAILBACK_RUNBOOK.md)
完成雙端備份、DR-era writes reconciliation、sequence、Auth、Storage 與付款資料
驗證後，才能短暫凍結 DR 並提升 Primary。

## 2026-11-23 應用程式發布回復證據

應用程式 Plan 使用目前 Primary 的固定 redeploy 部署作為回復候選。透過 GitHub API 驗證原受保護發布執行，並對儲存庫保留的原封存位元組比對 SHA-256。再讀回 Vercel 的部署來源、正式路由設定中繼資料及 Primary 執行狀態。資料庫、Edge 與路由合約仍比較固定來源，僅允許已驗收的健康診斷 rate-limit 清理變更。回復候選或設定發生變動時，驗證須重新建立證據。

## 2026-11-23 Production promotion readback

Vercel project reads for promotion, baseline and recovery checks include rollbackInfo=true. The observed successful promotion record for the serving b203d3cd deployment binds the next Plan to the exact deployment, source, prior Plan and promotion timestamp. The qualified 4e95d2ea artifact remains the recovery candidate.

## 2026-11-25 QR menu search release

The next application Plan binds its serving baseline to deployment `dpl_CRCcUb6iw1eZRktvhtEMbnwcCSXB`, source `bdd968cf3fceb6d392e003e32d8f602f633f7541`, original Plan 45164609710 and the provider's successful promotion at 1795434958582. Run 45599070216 separately passed the 26 smoke checks. Apply 45169140104 retains its failed conclusion. The qualified recovery deployment stays pinned to `4e95d2ea`.

Before Apply, run the protected baseline QR recheck while the dedicated stall accepts orders. If the session is refused, retain the Plan and check its validity again in the next open window. After a successful Apply, dispatch Production QR menu search acceptance on the serving main revision. It checks the dedicated session and menu search without placing an order. Record both runs alongside the new Plan and Apply.
