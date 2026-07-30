# 外送平台 Production Canary

## 狀態

僅提供程序，未建立、未執行、未核准。不得使用真實顧客訂單作為第一次 Canary。

## 前置條件

- PR 已審查並由正式 Release Workflow 套用 Expand-only Migration。
- 新 Feature Flag 仍全部關閉。
- Primary 健康、DR 仍唯讀、備份可用。
- Provider Sandbox/Production Credential、Callback 與 Signature 已人工驗證。
- 專用測試攤位、測試商品、測試 Store Mapping 已核准。
- Test Order 可明確標示並排除營收、用量與通知。

## 步驟

1. 僅對測試 Organization/Stall 開啟 Foundation 與單一 Provider Flag。
2. 先測 Connection/Store/Menu Read-only。
3. 送出一筆 Provider 核准的合成訂單。
4. 驗證 Webhook Ledger、External Order、Canonical Order、KDS、Payment Reconciliation。
5. 測試 Duplicate Webhook、Provider Timeout 與 Mapping Failure。
6. 關閉 Flag，確認不再接收新流量且既有工作可安全收尾。
7. 匯出不含個資的 Canary 證據並由安全/營運核准。

## 停止條件

跨租戶資料、重複訂單、現金誤計、Signature 異常、DR 寫入、無法回復的 Provider Action、錯誤率或延遲超標時立即停止。
