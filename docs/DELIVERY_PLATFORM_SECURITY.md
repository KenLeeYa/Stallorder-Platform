# 外送平台安全設計

## 信任邊界

1. Provider Webhook：不信任，必須驗證 Method、Content-Type、大小、簽章、Connection、Store 與 Schema。
2. Merchant/Admin API：重新驗證 Session、CSRF、RBAC、Organization、Stall、Entitlement 與 Feature Flag。
3. Job Worker：只接受資料庫內已驗證工作，並以 Primary Writer Guard 執行。
4. Canonical Order：價格、對應、供應狀態與付款狀態由後端決定。

## OWASP 控制

- BOLA/IDOR：Organization 與 Stall 從 Session Membership 解析，查詢同時帶 Scope。
- Broken Authentication：沿用 Hash-only StallOrder Session、Rotation、Revocation 與 CSRF。
- Injection/Mass Assignment：Zod Strict DTO 與 Prisma Parameterization。
- Security Misconfiguration：所有新 Flag 預設關閉；Mock 在 Production Runtime 硬拒絕。
- Integrity Failure：Webhook HMAC/Provider Signature、Payload Hash、Replay Key、Action Idempotency。
- Logging Failure：僅記錄安全 Error Code、Provider、Circuit 與內部 ID，不記 Raw Payload、Token、地址、電話或備註。
- SSRF：Live Adapter 尚未啟用；未加入可由商家輸入的任意 Provider URL。

## Secret

公開資料表只允許 Secret Reference；Migration Check Constraint 拒絕看似 Raw Credential 或 Plain PKCE Verifier 的值。實際 Secret 必須放在 Vercel Encrypted Environment、Supabase Vault 或 Provider Secret Manager。

禁止記錄：

- OAuth Authorization Code、Access/Refresh Token、Webhook Secret。
- Provider Customer Address、Phone、Note。
- Database URL、Session/CSRF Token。

## Fail Closed

缺少 Partner Approval、Credential、Feature Flag、Entitlement、Active Connection 或 Store/Menu Mapping 時，拒絕 Provider 動作或將訂單轉成 `MAPPING_REQUIRED`，不建立部分訂單。

## 尚待外部驗證

Uber Eats 與 foodpanda 正式 Signature、OAuth Callback、Scope、Rate Limit 與 Error Mapping 必須在取得官方文件及 Sandbox 後驗證。目前 Adapter 僅為 Fail-closed Scaffold。
