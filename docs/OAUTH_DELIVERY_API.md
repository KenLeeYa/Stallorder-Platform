# OAuth 與外送 API

所有錯誤回應不包含 Token、Raw Provider Payload 或 Database Detail。Mutation 除 Provider Webhook/Callback/Cron 外，均要求 StallOrder Session、Trusted Origin 與 CSRF。

## OAuth

| Method | Route | 說明 |
| --- | --- | --- |
| GET | `/api/auth/providers` | 取得後端評估後的登入按鈕狀態 |
| GET | `/api/auth/:provider/start` | 建立 State/Nonce/PKCE Transaction |
| GET/POST | `/api/auth/:provider/callback` | 一次性 Provider Callback |
| GET | `/api/auth/identities` | 目前使用者已綁定身分 |
| POST | `/api/auth/identities/:provider` | 近期 Session 或 Invitation 啟動 Linking |
| DELETE | `/api/auth/identities/:provider` | Step-up 後解除 Linking |
| POST | `/api/auth/refresh` | 旋轉 StallOrder Session |
| POST | `/api/auth/logout-all` | 撤銷 Profile 所有 Session |
| GET | `/api/auth/me` | 取得最小化 Session Profile |
| POST | `/api/auth/apple/events` | Apple Server Event，接受 `payload`（相容 `signedPayload`）並驗證正式 JWS 簽章 |
| GET | `/api/auth/mock/authorize` | Local/Preview only Mock OIDC |
| GET | `/api/admin/auth/migration-readiness` | Platform Admin 遷移統計 |
| POST | `/api/admin/users/:userId/identity-invitations` | 建立單次 Linking Invitation |
| POST | `/api/admin/users/:userId/sessions/revoke` | 管理員撤銷 Session |

`POST /api/auth/login` 在 OAuth-only Flag 開啟後回傳拒絕；目前 Flag 預設關閉，等待 P11 遷移閘門。

## Merchant Delivery

| Method | Route | 說明 |
| --- | --- | --- |
| GET/POST | `/api/merchant/integrations/delivery` | 清單／提出整合申請 |
| GET/PATCH | `/api/merchant/integrations/delivery/:connectionId` | 詳情／允許的生命週期動作 |
| GET/POST | `/api/merchant/integrations/delivery/:connectionId/stores` | 外部門市清單／選擇門市 |
| GET/PUT | `/api/merchant/integrations/delivery/:connectionId/menu-mapping` | 菜單對應 |
| GET | `/api/merchant/integrations/delivery/:connectionId/orders` | 外送訂單與對帳 Projection |
| GET | `/api/merchant/integrations/delivery/:connectionId/logs` | 安全化營運事件 |

## Platform Admin

| Method | Route | 說明 |
| --- | --- | --- |
| GET/POST | `/api/admin/delivery-integrations` | 待審清單／建立核准的合成連線 |
| PATCH | `/api/admin/delivery-integrations/:requestId` | 要求補件、核准或拒絕 |
| PATCH | `/api/admin/delivery-connections/:connectionId` | 啟用、暫停、恢復、斷線、重試 |

## Webhook/Worker

| Method | Route | 驗證 |
| --- | --- | --- |
| POST | `/api/webhooks/delivery/:provider` | Provider Signature、Connection、Rate Limit、Replay Key |
| GET | `/api/cron/delivery-jobs` | `Authorization: Bearer` Cron Secret |

## DTO

Request DTO 均使用 Strict Zod Schema；未知欄位、非 UUID、過大字串、錯誤狀態與未授權 Object Scope 會被拒絕。詳細 Provider Payload Contract 位於 `delivery-order-contract.ts`。
