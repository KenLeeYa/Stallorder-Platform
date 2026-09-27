# LINE 整合決策與下一批邊界

2026-09-26，狀態：協定基礎已實作；整合設計尚未全部落地。本文不可作為正式收款核准。

## 已實作

- `src/server/payment-providers/line-pay-v4.ts` 是固定 Sandbox、v4、商家直收的 server-only transport。沒有可切換到正式主機的參數，沒有自動重送 mutation，也沒有修改訂單／庫存／付款資料。
- Request 明確設定自動 capture，保存原始 transaction ID 的字串表示。只有 Confirm 的交易、原商家訂單及支付方式合計均相符才回傳已確認的證據。呼叫端仍須持久化證據後才可更新原訂單。
- GET 簽章使用與 wire 一致的 query（不含 `?`）；POST 只序列化一次。19 位 ID 從 Node 24 JSON reviver source 取得；不對已四捨五入的 Number 做 String()。
- MINI App 身分由 LINE 官方 verify endpoint 驗證原始 ID Token，不使用前端 profile JSON。驗證結果只含必要身分，不帶 Email、角色或行銷同意。
- MINI 身分命名空間包含 Provider、內部 Channel 環境與 Channel ID，與既有管理者 Web LINE 登入隔離。這是保守的分離策略；本輪已沿用既有 Session 建立流程；不建立任何商戶權限，並拒絕已升為操作員的 MINI 身分。
- 公開永久連結只允許店面與受控 view/locale；私人訂單、tracking token、外部 origin、編碼繞過不能被複製為分享連結。

## 既有核心與缺口

`PaymentProviderTransaction`/`PaymentProviderRefund` 是既有 provider 台帳；`online_order_payment_intents` 是另一個限定 LOCAL_MOCK 的線上付款基礎。後者目前一訂單一 intent、provider CHECK 限定 LOCAL_MOCK，不可直接刪約束改成可正式收款。平台訂閱的 `PaymentAttempt` 也不能挪作顧客餐點付款。

下一批需選定並擴充單一既有台帳，接回同一個 `payments`、訂單事件、KDS／列印與完成單計費。不可將兩套台帳各自當成付款真相。此資料遷移尚未實作／套用。

必要持久化責任：

1. 每次 attempt 綁定 Organization、Stall、Order、收款商家、環境、API 版本及可用的憑證版本引用；以複合外鍵拒絕跨店。金額由既有訂單重算，客戶確認舊金額不相符須重新確認。
2. Request／Confirm／Refund 各自唯一 operation key + request fingerprint；交易鎖與 lease fencing 防止 callback、重按與 worker 同時執行。先寫 operation 再呼叫外部，不在長 DB transaction 內等待網路。
3. 高熵 return state 只存 hash，綁 attempt、用途與期限。Callback 的參數不是支付／PII 授權；無 Session 也能恢復查證，但不能因此顯示訂單個資。
4. Provider 成功、DB 尚未完成時，operation 保持待恢復。安全查詢找到證據後，以既有原子付款及 outbox 提交；重複證據不得重複出餐或計費。
5. 不確定退款占用可退餘額；第二筆真實付款即使違反本地單一 attempt 假設也要留證、超收告警，不能丟棄。

## MINI App 與通知後續銜接

既有 `CustomerContactLink.customerReferenceId` 實際連到 Order，是單筆訂單通知綁定，不是顧客會員表。MINI 顧客應沿用現有 Profile/AuthSession 技術，不另簽 Supabase JWT；但必須先完成一次性伺服器 challenge、同源／CSRF、session rotation、顧客訂單關聯及帳號切換隔離。

OA 保留現有原始 body HMAC、destination 綁定、Vault 與 notification jobs。MINI Service Message 是另一種通道，必須有認證、核准模板與受控 token 發行／輪替／配額。不能把 OA push 成功當成 MINI Service Message 完成。

## 環境

試點店名／slug 只作設定查找，不能作租戶授權。使用者確認已有 MINI 測試 Channel／LINE Pay Sandbox，安全設定位置尚待提供。正式帳戶、Provider 歸屬、試點 Organization/Stall 及審核狀態不猜測填值。

3023 仍由原 UI 改版工作樹服務；本分支新增登入 challenge migration，僅套於本機獨立 clone，短暫 3024 QA 後停止，沒有 Production 寫入。現有 registry 的 CONTRACT_ONLY 保護維持，尚未讓使用者呼叫新 transport。

## 第二批已採用的 Session 決策

沿用既有 `oauth_transactions` 的 PENDING→PROCESSING→CONSUMED/FAILED 生命週期，新增預設 OAUTH 的 flow 欄位及 MINI tenant/channel/environment fingerprint；不另造 Session/JWT。MINI 的 nonce_hash 是本應用 browser cookie 綁定，不是傳給 LIFF 的 nonce。既有密文欄位保存 flow purpose，MINI 不偽造 OAuth authorization code／PKCE 請求。標準 callback 於 claim 前拒絕 MINI flow，完成登入亦核對 flow 及 fingerprint。

LIFF 套件固定 2.31.0，只載 core/login/isLoggedIn/getIDToken。MINI 文件限定 CSP 來源，禁止 referrer、導航記憶與 Vercel 分析攜帶初始化 URL；一般應用仍沿用原設定。Next dev 文件實測回傳 no-cache（框架覆寫），API no-store 經實測；Production header 尚未驗證。

入口目前僅登入＋開啟既有公開菜單，尚未把私人訂單綁顧客 Session，也沒有提供 `/mini/store/*` 完整工作流程。此殼層不是完成點餐整合。
