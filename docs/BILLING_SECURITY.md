# 帳務安全基線

## 存取控制

- API 從 server-side session 與 membership 推導 organization，不信任前端 tenant ID。
- 商家 mutation 使用 organization permission；平台 mutation 使用 Platform Admin authorization。
- authenticated write 維持 session-bound CSRF 驗證與 SameSite／HttpOnly session cookie。
- Finance Viewer 唯讀；Organization Admin、Staff、Kitchen 不可改帳務。

## 輸入與交易

- 所有 API body 經 Zod 驗證，金額為正整數 TWD，字串有長度與格式限制。
- Invoice 價格由伺服器重算；付款狀態不得由 client 或 redirect 決定。
- 付款提交使用 organization-scoped idempotency key。
- 驗證付款、Invoice paid 與 Subscription active 在同一 Prisma transaction 執行。
- 關鍵數量限制以資料庫 advisory lock／transaction lock 防止並行越界。

## 秘密與敏感資料

- 不保存卡號、CVV、完整銀行帳號、付款密碼或原始 webhook payload。
- Provider secret 僅能存在 Vercel Environment Variables 或核准的 Secret Manager。
- Server-only 變數不得使用 `NEXT_PUBLIC_`；不得輸出連線字串、token、付款參考或顧客資料到 logs。
- webhook 僅保存固定長度 payload hash，未來仍須在 hash 前驗證簽章與 request size。

## Provider fail closed

- ECPay、NewebPay 與電子發票 Adapter 預設丟出 not-configured error。
- 對外 webhook route 在停用時回 404 `SERVICE_NOT_ENABLED`，不讀 body、不建立 event、不變更 Invoice。
- Mock Provider 僅允許測試環境；正式 runtime 無測試 credential 或外部 request。
- 任何 future flag 被誤開但 Provider 尚未配置時仍保持關閉。

## 稽核與監控

- 敏感 mutation 保存 actor、request ID、entity、before/after 與時間。
- 應監控付款審核失敗、跨組織拒絕、重複 idempotency、狀態轉換失敗及 outbox backlog。
- Log 不得包含付款 note、銀行末碼、session、CSRF、QR、Turnstile 或 Provider token。

## OWASP 對應

- A01：RBAC、RLS、租戶複合外鍵。
- A02：Secret Manager、TLS、敏感欄位最小化。
- A03：Zod、Prisma parameterization、固定 SQL function。
- A04：伺服器定價、狀態機、冪等與 transaction lock。
- A05：feature flag fail closed、explicit grants、security headers。
- A07：既有 session、CSRF、rate limit 與登入保護維持不變。
- A09：audit、structured logs、notification/outbox 監控。

