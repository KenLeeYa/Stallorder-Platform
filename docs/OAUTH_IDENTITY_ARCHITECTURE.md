# OAuth 身分與 Session 架構

## 階段狀態

- P1-P4 已實作為 Expand-only Foundation。
- Google、LINE、Apple Adapter 與 Mock OIDC 已完成型別及自動測試。
- OAuth-only UI 由 Server-side Flag 控制，預設關閉。
- Local Password 尚未刪除；P11 必須等高權限帳號遷移、正式 Provider Callback 與 Canary 全部通過。

## 登入流程

```text
/api/auth/:provider/start
-> one-time oauth_transactions
-> state + nonce + PKCE
-> Provider
-> /api/auth/:provider/callback
-> verify code / signature / iss / aud / exp / nonce
-> lookup (provider, provider_subject)
-> existing Profile or new Profile
-> StallOrder opaque auth_session
```

Provider Token 不作為 StallOrder Authorization Token。RBAC、Organization、Stall 與 Platform Role 只來自既有伺服器資料。

## 身分鍵

`auth_identities` 唯一鍵為 `(provider, provider_subject)`；Email 是 nullable Profile/Contact Data，保存來源與驗證狀態，但永不作為自動 Link 依據。

## Linking

- 已登入使用者：必須是最近 10 分鐘建立的 Session，且通過 CSRF。
- 未登入的既有高權限帳號：必須使用 Hash-only、單次、可撤銷、限 Provider 的 Link Invitation。
- 身分已綁其他 Profile 時拒絕，不靜默搬移。
- 解除最後一種可登入方式會被拒絕；Apple 需先完成 Provider Revocation。
- Linking/Unlinking 會撤銷既有 Session 並寫入 Audit Log。

## Session

- Cookie：`HttpOnly`、`Secure`（Production）、`SameSite=Lax`。
- Database 只保存 Session/CSRF Token Hash。
- 支援 Rotation Family、Reuse Detection、Profile Session Version、Logout-all。
- CSRF、Origin、Rate Limit、Device/IP/User-Agent Hash 均不保存原始值。

## Apple Event

Apple Server-to-Server Event 使用獨立 Ledger 與 Event Hash 去重；未取得正式 Apple Key/Console 驗證前保持停用。First-login `user` 欄位只接受一次、經 Schema 驗證後保存必要 Profile Data。

## Migration Gate

`npm run auth:migration-report` 只輸出統計，不輸出 Email 或身分值。Platform Admin、Primary Owner、Staff/Kitchen 必須全部有已驗證 Provider Subject，且正式 Callback/Canary 通過後，才可進入 Local Credential Contract Removal。
