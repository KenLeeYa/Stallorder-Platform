# StallOrder Go-Live Checklist

任何未完成的 blocking 項目都不得以口頭確認取代。負責人需記錄日期與證據連結，不記錄 secret。

## Supabase

- [x] Supabase Organization selected：`KuanGuard`
- [x] Project costs explicitly confirmed
- [x] Production Project `stallorder-production` active
- [x] Staging project ref `daeqwtpaxcebmtwxqdkj` active（顯示名稱待改為 `stallorder-staging`）
- [x] Projects use `ap-northeast-1` and are fully isolated
- [x] Migrations applied to Staging
- [ ] Staging tests pass
- [x] Staging Security／Performance Advisor reviewed
- [x] Migrations applied to Production with no drift
- [x] Production has no demo seed／account／QR／customer order
- [x] RLS and cross-tenant validation passes
- [x] Security Advisor has no unresolved critical/high finding
- [x] Required index／constraint／Cron／function exists
- [ ] Edge Functions deployed and versions recorded
- [ ] Production Edge secrets configured independently
- [ ] Edge logs contain no secret／token／stack trace

## Turnstile 與 QR

- [ ] Turnstile Production Widget created in Managed mode
- [ ] Allowed hostname is exactly `app.qidaigo.com`
- [ ] Site Key is configured only as public Vercel variable
- [ ] Secret Key is configured only in Supabase secrets
- [ ] `TURNSTILE_ALLOW_TEST_KEYS=false`
- [ ] Invalid／expired／replayed／wrong-hostname／wrong-action tests pass
- [ ] Emergency pause／resume／revoke／rotate／sold-out／close tested
- [ ] Production test QR uses high entropy and database stores only hash
- [ ] `EMERGENCY_QR_DEGRADED_MODE` 保留菜單只讀，新 session／新訂單皆回傳 503
- [ ] Backend 被 fence 時顯示櫃台點餐指引，且不顯示假成功
- [ ] `activeBackend`／`promotionEpoch` 變更後建立新 session，不沿用舊 session
- [ ] 公開菜單離線快取不含訂單 mutation、追蹤、付款、pickup code、session 或顧客資料

## Vercel 與網域

- [ ] Vercel project `stallorder-platform` connected to GitHub
- [ ] Preview uses only Staging Supabase and secrets
- [ ] Vercel Preview build and smoke test pass
- [ ] Production variables use only Production resources
- [ ] Production deployed from an approved `main` commit after CI
- [ ] `app.qidaigo.com` verified and primary
- [ ] `qidaigo.com` redirect works
- [ ] `www.qidaigo.com` redirect works
- [ ] HTTPS certificate active on all three hostnames
- [ ] Security headers active
- [ ] `/api/health` operational and minimal
- [ ] No secret appears in HTML／client JavaScript／logs

## GitHub／CI

- [x] `CI` passes lint, typecheck, unit, database tests, db lint, build, audit
- [x] Production guardrails pass
- [ ] `main` requires successful CI
- [ ] GitHub `production` Environment is protected with approval
- [ ] Remote migration dry-run passes before apply
- [x] No committed `.env`, password, service key, Turnstile secret, OAuth secret or Vercel token

## Bootstrap 與功能

- [ ] PLATFORM_ADMIN bootstrap audited
- [ ] Google-linked 申請送出後未建立 Organization／Stall／Subscription／QR
- [ ] Platform Admin 核准交易只建立一個 Organization、Owner 與 Trial Subscription
- [ ] Initial stall was CLOSED, ordering disabled and QR PAUSED
- [ ] 設定測試訂單為 `is_test=true`、`WAITING_CONFIRMATION`，且未進用量／營收／付款對帳
- [ ] 測試訂單完成前 Go-live 被拒絕；完成後仍未自動開放
- [ ] Organization Owner 明確確認後，QR 才轉 ACTIVE 且 Stall 才轉 OPEN
- [ ] Applicant／Organization／Stall RLS 與 internal review note 隔離通過
- [ ] Staff confirmation and Realtime new-order flow tested
- [ ] Kitchen item／batch workflow tested
- [ ] Dine-in table／additional order／served／cleaning flow tested
- [ ] Takeout three-digit pickup verification tested
- [ ] Cash checkout／change／discount approval／payment reconciliation tested
- [ ] 線上付款只在供應商明確 `AVAILABLE` 時提供
- [ ] 兩個線上付款供應商不可用時仍可建立訂單並使用現金／人工付款
- [ ] 人工付款不會被標記為 provider-confirmed
- [ ] Cancel confirmation and cancellation reason tested
- [ ] Product／modifier price／sold-out／import preview tested
- [ ] Print queue／retry／reprint／offline alert tested
- [ ] Daily report／scheduled report／payment variance tested

## Monitoring、備份與復原

- [ ] Vercel and all Supabase log sources monitored
- [ ] External uptime monitor covers `/api/health`
- [ ] Alerting covers 5xx, Turnstile, rate limit, replay, QR mismatch, timeout, DB and Cron
- [ ] Supabase platform backup available
- [ ] Weekly logical and Storage backup configured
- [ ] Restore test completed and evidence recorded
- [ ] Rollback plan rehearsed
- [ ] Emergency ordering pause tested
- [ ] RPO／RTO and incident contacts approved
- [ ] Primary 與 DR environment-local backend identity 已設定並啟用 fence
- [ ] `check-dr-readiness` 全綠且 sequence reserve 已驗證
- [ ] Primary freeze rollback、DR promotion、DR write rejection 已在隔離環境演練
- [ ] Offline 舊 epoch queue 同步後無 canonical duplicate
- [ ] Primary failback、DR demotion 與單向複寫重建已演練
- [ ] Failover／failback requester、approver 與事故證據保存流程已核准
- [ ] Staff 訂單看板已驗證 SSE、Realtime、5 秒輪詢狀態與自動復原
- [ ] QR、Turnstile、Edge、Vercel、付款供應商與雙 backend 故障矩陣已演練

## 最終核准

- [ ] Production smoke test has no FAIL or required SKIP
- [ ] Go-live blockers list is empty
- [ ] Technical owner approval
- [ ] Merchant operations owner approval
- [ ] Security／data owner approval
- [ ] Go-live time and rollback window recorded

## 商業帳務 Production Gate

- [ ] 四個 commercial billing migrations 已先在 Staging 驗證，Production 尚未套用前不得勾選
- [ ] Trial 期限／100 筆硬限制與 paid soft quota 已以核准測試組織驗證
- [ ] Invoice 部分付款、完整付款、拒絕、啟用、停權、恢復與 audit 已通過
- [ ] Owner／Finance／Admin／Staff／Kitchen／Anonymous RLS 正反案例通過
- [ ] ECPay、NewebPay、自動帳務、Email 與電子發票 flags 全部為 false
- [ ] Disabled webhook 回 404，沒有 future table 寫入或外部 request
- [ ] Production migration 備份、維護窗、監控、rollback owner 與核准人已記錄
- [ ] 依 [BILLING_TEST_PLAN.md](BILLING_TEST_PLAN.md) 完成正式 release gate
