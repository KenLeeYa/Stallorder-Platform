# Security Model

## 租戶與授權

- 商家 API 使用 `MANAGE_PAYMENT_INTEGRATIONS`、session authorization、CSRF、request ID 與 audit event。
- 每張表啟用並強制 RLS；browser roles 沒有直接 privilege，只有 backend service role 可寫。
- composite FK 將 organization 與 stall/order/payment/document/connection 綁在一起，防止跨租戶 ID 拼接。

## Secret 與個資

- Provider credential 只存 secret reference，不存或回傳明文。
- 載具值使用 AES-256-GCM；Production 沒有獨立 field key 時 fail-closed。
- safe snapshot 只含遮罩／雜湊；redactor 遮蔽 api key、secret、carrier 等欄位。
- 錯誤訊息先正規化，audit 只記 error code，不寫 Provider 原始敏感 response。

## 網路與供應鏈

- 正式 Provider endpoint 只能來自程式碼 allowlist；不接受使用者自訂 URL，以降低 SSRF。
- webhook 在簽章、timestamp、replay protection 與官方 contract 未驗證前不開放。
- Mock 禁止在 Production runtime 使用；production issue flag 單獨打開仍會被 release gate 阻擋。

## 剩餘 Gate

正式 secret manager、key rotation、Provider IP/domain policy、webhook signature、credential revocation、incident drill 與 penetration test 尚未取得外部證據。
