# LINE v2 安全與資料邊界

2026-09-27。適用本機候選；正式 WAF、CDN/反向代理/存取日誌、Secrets、備援與真實手機仍須外部驗收。

| 威脅 | 控制與資料 | 實際邊界 |
|---|---|---|
| 假身份/角色提升 | 官方 raw Token verify、精確 audience、短效challenge、原Session rotation、拒operator identity | 不採 client profile/email合併，不建商家membership |
| 跨會員/門市 | immutable owner、原店權限/CSRF、FORCE RLS、參數化SQL、原order同交易 | API/SQL負向證據見 TEST_REPORT |
| 任意發訊/錯OA | 平台唯一 registry、固定bot/info、server模板與收件人 | 商家不能讀密鑰/快照或指定to；provider真驗待完成 |
| 重播/未知Push | immutable密文bytes+retrykey、lease/fence、24h人工窗口 | API接受不是實際送達 |
| QR/圖片外洩 | 各256-bit purpose分離票據、hash+AAD密文、no-store、限流、明確POST | 圖片可被转傳/快取；server撤銷/原子核銷是最後防線 |
| 假付款/跨商家 | 原訂單owner、server金額/版本、原商家憑證快照、長ID無損、固定Sandboxhost | 沒有LIVE適配；callback不是登入/PII授權 |
| 重付/超退 | durable operations、原order先鎖、UNKNOWN保留、worker只安全查詢 | 不明結果不能直接改現金或當退款失敗重送 |
| 環境混用 | VERCEL_ENV/內部Channel/Endpoint/DB fingerprint對照 | fingerprint不是資料庫遠端身分證明，發布仍需readback |
| 訪客盜歸戶 | consumed原Session+device+tracking+每單HttpOnly加密proof | 非僅短碼/QR/電話；proof補發失敗不重建原單 |
| Log/分析 | MINI URL遮罩、媒體與回跳no-referrer、固定錯誤、私有資料不進URL | provider/平台邊緣access log遮罩仍須確認 |

## 資料最小化與保存

- Raw ID Token僅記憶體；不入DB/URL/localStorage/artifact。subject必要時AES-256-GCM保存；查找以env/Provider hash。資料金鑰32-byte Base64、server-only；更換須有版本/舊資料可解密遷移，不直接棄舊key。
- OA credential留原Vault；Pay credential為server環境版本化reference。reference不是允許對商家公開的secret。快照固定原版本，撤銷舊版本前先清查未結交易。
- Webhook只留簽章驗證後最少event ID/時間/subject關係，不保存群組對話或抓全部好友。晚到follow不覆蓋unfollow。
- Member同意與Audit分開，無預設行銷。好友不是入會，封鎖不刪帳本。刪除/資料請求沿原privacy流程；本次不發明法定保存年限。
- 原付款/退款/交付/計費證據依原保存政策；不能以rollback/測試清理刪除真實帳務。合成fixture只留隔離庫。
- 新表採SQL migrations及FORCE RLS，anon/authenticated無private內容權限。通知舊status必要read與密文欄位權限分開。沒有新增公開Realtime private-table publication。

## 網路與操作

外部provider host固定、禁止redirect、bounded timeout/response；OA/Pay/LIFF憑證用途分離。退款、補發、rollout需要原權限、CSRF與稽核。Cron使用原secret認證，不提供公開worker操作。local wakeup不沿clone中的遠端Vault URL發送。

正式前需確認：WAF允許合法LINE webhook/Pay回跳但不廣泛bypass、Webhook原body及HMAC、私有頁cache、media URL/APM遮罩、備份/復原與平台客服查阅流程。尚未驗證者列BLOCKED，不以HTTP200或本機fixture取代。
