# 商家申請安全設計

## 信任邊界

```text
Google OAuth -> verified Supabase identity -> application session
application browser -> Origin + CSRF + Zod + rate limit -> trusted Next.js service
Platform Admin -> RBAC + CSRF -> review / approval transaction
Organization Owner -> RBAC + CSRF -> setup / explicit go-live transaction
```

- 申請者 profile、email 與 display name 由 session 取得，不接受 client 指定。
- 只有具有 `auth_user_id` 的有效 Google-linked profile 可建立或送出申請。
- 有有效 membership 的帳號不得走一般申請流程；有效邀請優先於建立申請。
- Client 不可指定狀態、risk、reviewer、Organization、Subscription、Plan Version 或 entitlement。

## 防濫用

- 送件限制：profile／email hash 每 30 天 3 次，IP hash 每小時 5 次、每日 10 次，session 每日 5 次。
- 只保存核准的 IP、phone、registration 與 device/session 雜湊，不保存完整 IP。
- 重複 email、phone、registration、slug、既有 membership 與 prior rejection 進入規則式風險評估；Phase 1 不自動核准。
- 被 Platform Admin 封鎖的來源無法以相同 IP／session hash 再送件。

## 核准與上線

- 核准使用 Serializable transaction 與 application row lock，唯一索引防止重複 active application、Organization link 與 setup link。
- 核准只建立 PAUSED QR 與 CLOSED Stall。
- 設定測試訂單由 trusted Next.js API 建立，仍使用既有商品、註記、價格、數量與訂閱資料庫驗證。
- `is_test=true` 只能略過 Trial／order package 額度，不可略過停權、失效訂閱或其他授權。
- 只有 `ORGANIZATION_OWNER` 可在完成測試訂單後明確 Go-live。

## OWASP 對應

- Broken Access Control：RBAC、Organization scope、FORCE RLS、owner-only go-live。
- Cryptographic Failures：敏感識別僅保存 keyed hash；token／secret 不進 log 或 client。
- Injection：Zod、Prisma parameterization、固定 SQL 與 transaction query。
- Insecure Design：申請、核准、設定、測試、上線分離，fail closed。
- Security Misconfiguration：匿名無 grants，future providers 預設停用。
- Identification Failures：Google verified identity、HttpOnly session、CSRF、rate limit。
- Logging Failures：重要 transition、拒絕與失敗皆帶 request ID audit。

## 回歸要求

每次修改必須重跑 unit、pgTAP、Playwright 與 build，並確認 Turnstile、QR session、idempotency、RLS、CSRF、rate limit、tenant／stall isolation 未弱化。
