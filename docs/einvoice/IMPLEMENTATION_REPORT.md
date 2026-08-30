# Implementation Report

日期：2026-08-30

```text
Existing invoice domain: 平台訂閱帳單 Invoice，保留且不重用
Existing TaxDocument: 平台計費稅務文件，保留且不重用
Reusable payment integration: RBAC、audit、setup center、server authority、fail-closed 慣例
Provider abstraction: provider-neutral interface + Mock + contract-only live adapters
Checkout invoice UI before work: 無

Repository audit                    PASS
Provider-neutral domain             PASS
Seller profile                      PASS（LOCAL MOCK）
Merchant provider connection        PASS（reference + LOCAL MOCK）
Provider capabilities               PASS（internal contract / Mock）
ECPay adapter                       PARTIAL（official entrypoints known; live contract BLOCKED）
ezPay adapter                       PARTIAL（public docs known; machine contract BLOCKED）
TradeVan architecture               PASS（safe fail-closed stub；live BLOCKED）
Invoice orchestrator                PASS（LOCAL MOCK）
Issue/query                         PASS（LOCAL MOCK）
Void                                PASS（LOCAL MOCK）
Allowance                           PASS（LOCAL MOCK）
Checkout UI                         PARTIAL（local Circuit B；Production/Edge OFF）
Merchant setup UI                   PASS（LOCAL MOCK）
Retry/reconciliation                PARTIAL（ledger/DLQ/reconcile；background worker BLOCKED）
Security/RLS                        PASS（local source + pgTAP）
Tests                               PASS（local unit/component/DB；external stages BLOCKED）
Documentation                       PASS
```

Readiness：`LOCAL_MOCK_READY`

## 驗證收據

- Prisma validate：PASS
- Prisma generate `--no-engine`：PASS
- targeted Vitest：5 files / 57 tests PASS
- orchestrator 安全修補回歸：3 files / 17 tests PASS
- pgTAP migration tests：12/12 PASS
- targeted ESLint：PASS
- full ESLint：PASS
- TypeScript typecheck：PASS
- full Vitest：461 files PASS、2 files skipped；2676 tests PASS、9 tests skipped
- Production build：PASS（Prisma Client 6.19.3、Next.js 16.2.11、98 個靜態頁面）
- Standard 原始碼安全掃描：104/104 review items 完成；掃描快照列出 1 個 LOW 與 2 個 Local Mock correctness 問題，現行工作樹均已修補，並由上述 3 files / 17 tests 驗證
- 本機 `127.0.0.1:3010` HTTP QA：登入頁 200、health `ok`、商家電子發票 API／頁面 200、`LOCAL_MOCK_READY`、TEST seller、MOCK connection、Production／checkout／platform flags OFF
- 公開 Menu：200；在 checkout／platform flags OFF 時不顯示電子發票選項
- 未登入商家頁：307 導向 `/login`
- 瀏覽器視覺 QA：NOT EVALUATED；瀏覽器自動化的 URL 安全政策拒絕存取 `127.0.0.1`，未繞過該政策。HTTP、元件測試與 Production build 不等同視覺驗證

安全掃描收據：

- snapshot digest：`codex-security-snapshot/v1:sha256:5add1a85389624c44fecf5a0923bcbd9f67a8dab907bf8ea3c42054a7e665b31`
- report：`C:\Users\KY\AppData\Local\Temp\codex-security-scans-3hvCyR\Stallorder-Platform-hotfix-media-payment-print-20260828\d6d65c007b7fbdc6125d28dadd1de82aa0bfdc9d_20260829T175338Z_61fddmr9\report.md`
- 掃描報告綁定修補前快照；目前修補狀態以現行工作樹與回歸測試為準

## 未完成且不可被誤判的項目

沒有正式 Provider contract、真實 Sandbox credential、官方 webhook 驗證、Pilot 商家、Production release 核准或合法電子發票證據。Production 開票與結帳功能旗標維持 OFF。
