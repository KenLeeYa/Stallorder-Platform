# StallOrder Roadmap

## 已完成：安全 QR 與單攤營運基線

- 短效單次 QR session、Turnstile、多維 rate limit、公開安全日誌。
- WAITING_CONFIRMATION、即時店員確認、未確認逾時、現金結帳、取餐碼。
- 商品分類/群組/供應、售罄、QR/攤位緊急控制。
- 應用 login/session、RBAC、CSRF、audit、monitoring、RLS。

## 已完成：多攤位 Phase 1-6

1. Organization/stall/profile/membership、scope backfill、RLS helpers。
2. Workspace、switcher、攤位 CRUD、人員與 role resolution。
3. Shared catalog、bulk assignment、price override、per-stall sold-out。
4. Daily summaries、organization Dashboard、comparison、reports/CSV。
5. Scoped Realtime、SSE/polling fallback、operational alerts/batch controls。
6. Plans、subscription、additional stall approval、invoice/usage、invitation。

## 已完成：商家申請 P0-P2

- 申請送件只建立 application，不建立 Organization。
- Platform Admin 人工審核與原子 Trial provisioning。
- 核准後 QR 維持 PAUSED、Stall 維持 CLOSED。
- 設定精靈、非計費測試訂單與 Owner 明確 Go-live。
- 申請／設定 RLS、audit、rate limit、pgTAP 與 Playwright 回歸。

## 發布準備

- 完整 migration/pgTAP/unit/build/Playwright/security scan。
- Production Google OAuth 與 redirect smoke test。
- 核准方案 base/excess pricing。
- Hosting、logging/alert routing、backup/PITR restore 演練。
- Staging 尖峰與跨裝置 QR/checkout smoke test。

## 下一階段 P1

- Modifier organization master + per-stall assignment + historical snapshot migration。
- Summary/usage/invoice 自動 reconciliation 與 lag metrics。
- Payment mismatch、stall offline、no activity alert detector。
- Billing provider 評估；初期維持人工核准與 invoice evidence。

## 成長階段 P2

- 50 攤/組織及活動尖峰 load test。
- 依量測決定 event retention、partition、cache、queue、organization summary。
- 隱私保存、資料匯出/刪除與商家自助維運。
- 方案 add-on 與更完整平台管理介面。

每項工作都必須維持單一 SaaS、多租戶 RLS、歷史資料不回算、可信後端與完整 audit。具體 acceptance criteria 見 [MULTI_STALL_GITHUB_ISSUES.md](MULTI_STALL_GITHUB_ISSUES.md)。

## 商業帳務路線

- Phase 1：人工帳務、方案／權益、用量與停權流程進入 release validation。
- Phase 2：完成 Provider／電子發票申請、sandbox、合規與安全 gate 後才可逐租戶 canary。
- Phase 3：先定義會計與指標，再實作 proration、portal、進階 analytics 與合作夥伴帳務。

詳見 [PHASE_2_BILLING_ROADMAP.md](PHASE_2_BILLING_ROADMAP.md) 與 [PHASE_3_BILLING_ROADMAP.md](PHASE_3_BILLING_ROADMAP.md)。

商家申請自動化仍停用；後續 gate 見 [PHASE_2_MERCHANT_APPLICATION_ROADMAP.md](PHASE_2_MERCHANT_APPLICATION_ROADMAP.md) 與 [PHASE_3_MERCHANT_APPLICATION_ROADMAP.md](PHASE_3_MERCHANT_APPLICATION_ROADMAP.md)。
