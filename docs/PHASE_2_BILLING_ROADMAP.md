# Phase 2 帳務路線圖（未啟用）

## 目標

支援 20～100 個商家時的自動付款、Webhook 對帳、失敗 retry、寬限期、自動續約、Email 通知與電子發票。Phase 1 不啟用任何一項。

## 外部申請

- 選定並申請 ECPay 或 NewebPay 商店，完成公司／商業登記、實質受益人與銀行帳戶驗證。
- 申請正式與測試環境，取得由核准人管理的 merchant ID、簽章／加密 secret。
- 選定台灣電子發票加值中心，完成財政部相關資格、字軌、統編與測試環境申請。
- 選定交易 Email 供應商，完成網域、SPF、DKIM、DMARC 與退信處理。

## 工程工作

1. 依 Provider 官方規格實作簽章驗證、固定 request size、來源與 timestamp/replay 檢查。
2. 在驗證簽章後才解析／保存最小化事件資料與 payload hash。
3. 以 `(provider, provider_event_id)` 冪等，核對 Invoice、organization、amount 與 currency。
4. 在單一交易更新 payment attempt、Invoice、Subscription、audit 與 outbox。
5. 實作 recurring agreement、payment query、refund、retry 與 grace-period 排程。
6. 電子發票實作開立、作廢、折讓、查詢、Webhook 與字軌監控。
7. Email 只由 outbox worker 發送，具去重、退避與 dead-letter 處理。

## 合規與安全

- 法務確認訂閱條款、退款、終止、稅務文件、個資保存與刪除政策。
- 不讓 StallOrder 進入卡號／CVV 儲存範圍；優先 Provider hosted flow 或 tokenization。
- Secret 存 Vercel／Supabase Vault，分 Preview／Production，建立 rotation 與 break-glass 流程。
- Threat model、滲透測試、Webhook replay／偽造／金額不符測試與稽核保存完成。

## 啟用 Gate

- Staging sandbox 端到端與退款測試通過。
- Provider callback domain、TLS、DNS、監控與 alert 已驗證。
- 對帳差異、retry、dead-letter、停機與 rollback runbook 完成。
- Production secret 由雙人覆核設定，未出現在 Git 或 logs。
- 只逐租戶 canary 啟用；`AUTOMATED_BILLING_ENABLED` 與個別 Provider flag 分開控制。
- 電子發票另以 `E_INVOICE_ENABLED` 控制，不隨付款 Provider 自動啟用。

