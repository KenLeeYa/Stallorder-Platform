# StallOrder Go-Live Checklist

任何未完成的 blocking 項目都不得以口頭確認取代。負責人需記錄日期與證據連結，不記錄 secret。

## Supabase

- [ ] Supabase Organization selected：`KuanGuard`
- [ ] Project costs explicitly confirmed
- [ ] Production Project `stallorder-production` active
- [ ] Staging Project `stallorder-staging` active
- [ ] Projects use `ap-northeast-1` and are fully isolated
- [ ] Migrations applied to Staging
- [ ] Staging tests pass
- [ ] Staging Security／Performance Advisor reviewed
- [ ] Migrations applied to Production with no drift
- [ ] Production has no demo seed／account／QR／customer order
- [ ] RLS and cross-tenant validation passes
- [ ] Security Advisor has no unresolved critical/high finding
- [ ] Required index／constraint／Cron／function exists
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

- [ ] `CI` passes lint, typecheck, unit, database tests, db lint, build, audit
- [ ] Production guardrails pass
- [ ] `main` requires successful CI
- [ ] GitHub `production` Environment is protected with approval
- [ ] Remote migration dry-run passes before apply
- [ ] No committed `.env`, password, service key, Turnstile secret, OAuth secret or Vercel token

## Bootstrap 與功能

- [ ] PLATFORM_ADMIN bootstrap audited
- [ ] First Organization／Merchant／Stall／owner created
- [ ] Initial stall was CLOSED, ordering disabled and QR PAUSED
- [ ] Production QR tested, then explicitly activated
- [ ] Staff confirmation and Realtime new-order flow tested
- [ ] Kitchen item／batch workflow tested
- [ ] Dine-in table／additional order／served／cleaning flow tested
- [ ] Takeout three-digit pickup verification tested
- [ ] Cash checkout／change／discount approval／payment reconciliation tested
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

## 最終核准

- [ ] Production smoke test has no FAIL or required SKIP
- [ ] Go-live blockers list is empty
- [ ] Technical owner approval
- [ ] Merchant operations owner approval
- [ ] Security／data owner approval
- [ ] Go-live time and rollback window recorded
