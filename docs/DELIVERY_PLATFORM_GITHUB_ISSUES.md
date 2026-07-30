# 外送平台後續 Issue 清單

## P0 Delivery Integration Foundation

目標：合併 Provider-neutral Schema、Adapter、RLS、UI 與停用 Flag。依賴 Production Resilience Base；不含正式 Provider。驗收：Unit/pgTAP/Build/安全審查與 Expand-only Rollback。

## P1 Mock Provider and Ephemeral Preview

目標：data-less Supabase Branch、Matching Vercel Preview、Mock OAuth/Webhook/Order/KDS E2E 與自動清理。依賴 Preview GitHub Environment；不含 Production Credential。驗收：Replay、Tenant Isolation、Cash Exclusion 與 Cleanup。

## P2 foodpanda Partner Integration

目標：依官方核准文件完成 Auth、Signature、Store/Menu/Order/Settlement Adapter。依賴 Partner Approval 與 Sandbox；不含未公開 API 或 Portal Scraping。需另開 Migration、API/RLS/Security Tests、Canary 與 Rollback。

## P3 Uber Eats OAuth and Eats API

目標：依 Uber 核准契約完成 OAuth、Token Vault、Webhook 與 Eats API。依賴 Partner Approval、Sandbox、Exact Scope/Callback；不含商家密碼。驗收含 PKCE、Token Rotation、Signature、Idempotency 與 Revocation。

## P4 Menu and Order Reconciliation

目標：Menu Diff、Modifier Mapping、Settlement Import、Payment Difference 與財務報表。依賴 P2/P3；不把平台款項視為現金。驗收含金額守恆、Mapping Failure、Write Cost 與 Forward Fix。

## P5 Dual-Circuit Resilience Validation

目標：Circuit A/B 同一 Ledger、Primary Fencing、Ambiguous Action、DR Read-only、Game Day。依賴正式 Provider Sandbox 與 Resilience 核准；不在 Production DR 寫入。驗收含故障演練、告警、Canary 與回復證據。

每個 Issue 建立時需補：Owner、Dependencies、Schema/API、Security/RLS、Test Matrix、Ephemeral Validation、Provider Approval、Production Canary、Rollout 與 Rollback。
