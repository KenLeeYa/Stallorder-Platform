# OAuth 與外送整合人工待辦

本文件只列出無法由 Repository 安全自動完成的項目。請勿將 Secret 值貼入 Issue、PR、Commit、Log 或本文。

## GitHub Preview Environment

在 GitHub `Preview` Environment 設定：

Secrets：

- `SUPABASE_ACCESS_TOKEN`
- `VERCEL_TOKEN`（要執行 Matching Vercel Preview 時）
- `VERCEL_AUTOMATION_BYPASS_SECRET`（Deployment Protection 開啟時）

Variables：

- `SUPABASE_PARENT_PROJECT_REF`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

確認 Preview Environment 需要人工核准，且只允許同 Repository PR。Vercel Preview Scope 不得包含 Production OAuth、Provider、Database 或 DR Secret。

## Google

Production Callback：

```text
https://app.qidaigo.com/api/auth/google/callback
```

人工工作：

1. 建立/選擇正式 Google OAuth Client。
2. 驗證 Consent Screen、品牌、Privacy Policy 與所需 Scope。
3. 登錄 Exact Callback。
4. 將 Client ID/Secret 寫入 Vercel Production Secret。
5. 完成實際 Callback、Issuer/Audience/Nonce 與 Logout 測試。

Preview 使用 Mock OIDC，不複製 Production Google Secret。

## LINE Login

Production Callback：

```text
https://app.qidaigo.com/api/auth/line/callback
```

人工工作：

1. 建立/選擇 LINE Login Channel。
2. 登錄 Exact Callback 與必要 Scope。
3. 確認 Email Scope 是否已獲 LINE 核准；未核准保持關閉。
4. 將 Channel ID/Secret 寫入 Vercel Production Secret。
5. 執行實際 Callback、Nonce、Subject、取消授權測試。

## Sign in with Apple

Production Callback/Event：

```text
https://app.qidaigo.com/api/auth/apple/callback
https://app.qidaigo.com/api/auth/apple/events
```

人工工作：

1. 建立 Service ID、Key、Return URL 與 Server-to-Server Notification URL。
2. 將 Team ID、Service/Client ID、Key ID、Private Key 寫入受管 Secret。
3. 驗證 Private Relay Email 與第一次登入 Name Payload。
4. 驗證 Apple Event Signature、Account Delete/Disable 與 Token Revocation。

## Uber Eats / foodpanda

- 取得正式 Partner Approval、Sandbox、官方 API/Signature 文件與 Test Store。
- 在 Provider Console 登錄核准 Callback/Webhook。
- Credential 只放受管 Secret Store，資料庫只放 Reference。
- 未完成前禁止開啟任何 Production Delivery Flag。

## Production

需要 Release Owner 人工核准：

- 合併基底 PR 與本 PR。
- Expand-only Migration。
- Flag 保持全部關閉的 Production Deployment。
- 備份、Primary/DR 狀態與監控。
- 獨立的 Synthetic Canary。
- P11 Local Password Removal Gate。

在任何 OAuth-only 或密碼欄位移除操作前，於受控環境執行：

```text
npm run auth:migration-report
```

只有 `readyForOAuthOnly=true`，且所有平台管理員、組織主要擁有者與
Staff/Kitchen 帳號都已完成 Provider 綁定與人工復原演練時，才可進入 P11。
報告不會輸出 Email、Provider Subject 或 Token。

目前禁止：自動合併、自動正式啟用、建立正式測試身分、刪除 `password_hash`。
