# LINE 安全與資料邊界

2026-09-26；協定層已驗證不等於租戶 API／DB 邊界已完成。新元件目前不公開為可收款 API。

| 面向 | 已實作 | 尚未完成 |
| --- | --- | --- |
| 傳輸 | 固定 Sandbox/API host、禁止 redirect、timeout、bounded response、錯誤訊息不含外部 raw body | 真實 Sandbox 憑證／網路結果 |
| ID Token | 官方伺服器 verify、issuer/audience/exp/iat、環境驗證、忽略 Email／role | 一次性 challenge、CSRF、節流與現有 session rotation |
| 身分隔離 | Provider/Channel/env namespace；不採 client profile 作證明 | 顧客訂單 mapping、帳號切換、訪客購物車安全合併 |
| 分享連結 | 同 Endpoint 公開店面、view/locale allowlist；拒私人資訊 | SDK 實際永久連結與 LINE WebView 返回 |
| 付款 | POST/GET 固定簽章向量、19 位 ID 無損、按 endpoint 分辨成功 | 租戶與金額 DB 約束、immutable account snapshot、lease fencing、回跳 state |
| 退款 | 明確正整數 amount | RBAC、可退餘額保留、並行、未知結果對帳 |
| 通知 | 現有 OA 模組回歸通過 | MINI token 輪替／配額／模板與通道去重 |

建議保存分類（待產品／資料政策落地，不是法定保存期結論）：

- ID Token、Pay／OA secrets：僅記憶體／受控 Vault；前端只短暫持有 SDK ID Token，不寫 URL、localStorage 或日誌。
- return state／login challenge：只持久化高熵值 hash 與必要關聯，短 TTL、一次性；清除不刪金流證據。
- 支付／退款台帳及 audit：保存必要金額、狀態與商家關聯，依現有帳務保存政策；secret 只保留引用及版本。
- Webhook／通知：最小 payload／hash，依來源與事件版本去重；不複製完整顧客名單至測試。
- 帳號刪除／撤回同意不自動刪除應保留的交易；行銷同意不從訂單電話或 LINE 登入推導。

下一批權限矩陣：顧客只讀自身該店訂單；店員需既有攤位權限；退款與憑證設定需商家授權；worker 僅操作自身租戶 operation；瀏覽器不能直讀 Vault／操作台帳。API、SQL/RLS、Realtime、worker 都需驗收，不能只測 handler。

本批不增加資料表、RPC、Storage 或 Realtime 規則。沒有 migration 被套用到本機或遠端。


第二批：一次性登入 challenge 綁 HttpOnly/Secure/SameSite cookie、server tenant/channel fingerprint 與 5 分鐘有效期；原始 ID Token 不保存。Session 沿用既有 opaque token、device、CSRF 及撤銷機制；API 成功 cookie 強制 Secure。標準 OAuth 與 MINI flow 互斥，不做 Email 自動合併或商家權限授予。MINI 分析停用、初始化 URL 不寫 navigation sessionStorage。私人訂單顧客所有權、商家金流憑證版本及完整退款邊界仍是後續必做項目。
