# foodpanda E2E Test Plan

## Local mock

1. 全部 live provider flags OFF。
2. 只在非 Production runtime 啟用 Mock provider。
3. 測 duplicate webhook、invalid Authorization、oversized body、store mismatch、order import、KDS 呈現與 DLQ。

## Sandbox

必要前提：sandbox client、secret、chain、vendor、webhook Authorization、測試帳號與 portal callback 均已由人工完成。

依序驗證 token reuse、完整 webhook、重播、GET order、reject、pickup ready、vendor-delivery dispatched、history reconciliation、availability update、429/401/timeout、停用 flag 後 fail closed。保存 request ID、event/job/order ID、時間戳與去識別化證據。

## Pass gate

不得有跨 tenant 寫入、duplicate canonical order、secret leakage、未處理 DLQ 或金額差異。沒有 live Sandbox 證據時狀態只能是 BLOCKED，不能宣稱 E2E PASS。
