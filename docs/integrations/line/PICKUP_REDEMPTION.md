# 平台 QR 交付核銷

2026-09-27。程式與自動測試證據須搭配本次 TEST_REPORT；本文件不代表正式啟用或 LINE 實機驗收通過。

## 操作入口

店員在原 `/staff/{stallSlug}` 訂單看板使用「平台 QR 掃碼交付」。只有具本店 `CHECKOUT_ORDERS` 權限且伺服器能力確認啟用時才出現。可開啟相機、使用條碼掃描器貼入 QR 內容，或選「人工核對／憑證管理」。

1. 先掃 QR，按「預覽餐點與付款」。相機辨識與預覽不寫取餐／完成狀態。
2. 核對本店訂單、餐點及付款。未付款先走原現金／付款程序；未 READY 或付款／退款仍待確認時不可交付。
3. 實際交付全部餐點後，勾選核對確認，再按「確認交付／完成取餐」。成功後刷新原訂單看板。
4. 重掃已取餐憑證只顯示既有完成時間，不再核銷。失去連線時不能離線視為成功；保留原操作 key 重试，或重新預覽取得伺服器狀態。

人工備援仍要選定本店原訂單、短取餐碼、原因及顧客／餐點核對確認，使用相同原子交付 command。相機不可用不構成繞過 READY、付款或店家授權的理由。

顧客的本人訂單頁可使用 `LinePlatformPickupCard` 的「顯示／更新取餐 QR」；API 使用既有 Session、CSRF 與固定平台訂單 ownership。媒體票據與短取餐碼不能取得他人私人訂單。

## 憑證與圖片

`line_platform_pickup_credentials` 是既有 `orders` 的擴充，每列參照 `line_platform_order_owners.order_id`，不保存第二套訂單。綁定 organization、stall、環境、credential version 及原訂單履約時間版本；DB trigger 驗證範圍。RLS 強制啟用，anon/authenticated 無讀寫 grant。

- QR payload：`qidaigo:pickup:v1:<32 random bytes base64url>`，256-bit 隨機能力票據，無姓名、電話、金額、LINE subject。
- media token：獨立 256-bit `qpm1_...`。圖片 endpoint 僅輸出自有 `image/png`，不回私人訂單 JSON，不核銷；取餐與媒體用途不能互換。
- DB 保存 token/media SHA-256，以及 AES-256-GCM 重繪材料。使用 `LINE_PLATFORM_DATA_KEY`（32 bytes Base64、server-only）與綁定 order/environment/purpose 的 AAD，不可從 hash 推回票據。
- 圖片以 qrcode 本地編碼，512px、M correction、四模組安靜區。相機用本地 jsQR 解碼；不向外部 QR 服務傳送憑證。
- `/api/line-platform/media/{mediaToken}` 設 no-store、no-referrer、noindex、nosniff，錯誤不輸出個資；有 IP hash rate limit。公開反向代理、CDN 與 APM 仍需在正式啟用前驗證 URL 遮罩。
- 圖片為可轉傳的能力票據，LINE／裝置可能保留舊圖或截圖。撤銷圖片不能抹除截圖；最後防線是服務端核銷。

## 有效期、改時間與重發

基準依 `committedFulfillmentAt`、`scheduledPickupAt`、`requestedFulfillmentAt`、`quotedReadyAt`、`createdAt` 順序選取；加 `PICKUP_TOKEN_GRACE_MINUTES`，預設 120，允許 15–1440 分鐘。媒體期限比 credential 多 24 小時以覆蓋讀卡及重試；expired credential 即使仍可顯圖也不能核銷。

取消、到期、全額退款或履約時間版本／預定時間變更會撤銷未用憑證。2026-09-28補齊正常確認時間的依賴：只有最新憑證因 `SCHEDULE_CHANGED` 作廢、原期限尚未到、新時段已 `CONFIRMED` 且仍可履約時，通知worker或本人取碼才在原訂單鎖內產生唯一新版、按新時段計算期限，留下 `LINE_PLATFORM_PICKUP_SCHEDULE_REFRESHED` 事件。舊 QR 與 media 永久失效；未確認新時段、人工撤銷、已過期或已核銷均不自動重發，不因掃描或讀圖片延長期限。合法延遲取餐仍由店員查版本、填原因受控重發，可明確設定有界新期限。已交付訂單不能重發。

## 原子交付與既有核心

`redeemPlatformPickup` 先鎖原 order，再鎖 credential，檢查同店、環境、版本、期限、PAID、READY、全部餐點 READY/SERVED、沒有 pending/UNKNOWN payment／refund，以及 idempotency payload。

同一短交易只做一次：credential consumed/actor/method/key → 原 order COMPLETED/completedAt → 原 `order_events` 的 `LINE_PLATFORM_PICKED_UP`。通知 migration 將此明確事件轉成既有 notification_jobs 的 ORDER_PICKED_UP；外部 Push 不在鎖內執行。新事件 unique(order_id) 與 credential unique key 防止重複副作用。

完成單 Billing 沿原 orders COMPLETED trigger 與唯一 usage ledger，不在核銷 handler 手動收費。READY、付款、取餐碼驗證、列印成功不會產生 LINE_PLATFORM_PICKED_UP。建立訂單時由伺服器凍結 owner.pickup_required：當時取餐功能啟用的 TAKEOUT 訂單，即使尚未開啟第一張 QR 也受 DB guard 保護，阻止舊 checkout／print 直接 COMPLETED。停用旗標不會解除既有交付要求。未啟用時建立的 owner 不追溯升級；舊無 owner 訂單流程保持相容。

## API

| Endpoint | 方法與權限 | 結果 |
|---|---|---|
| `/api/line-platform/pickup/{stallSlug}/capability` | GET，本店 CHECKOUT_ORDERS | 僅能力旗標 |
| `.../preview` | POST，權限、CSRF、rate limit | 最少餐點、付款、版本；不核銷 |
| `.../redeem` | POST，同上＋明確交付、expectedVersion、UUID key | 唯一完成，重試回原結果 |
| `.../manage` | GET／POST，本店權限；寫入另驗 CSRF／原因 | 查版本／撤銷／有界重發 |
| `/api/line-platform/pickup/customer/{orderId}` | POST，本人 Session＋ownership＋CSRF | 首次發行或現有有效 QR media |
| `/api/line-platform/media/{mediaToken}` | GET，獨立圖片能力票據 | PNG only，無核銷 |

## 驗證及尚待外部條件

`pickup-contract.test.ts` 驗用途、256-bit 格式、期限、手動核對與明確交付契約；`pickup-render.test.ts` 對實際 PNG 用獨立 jsQR 讀回。`pickup-http.test.ts` 驗本店權限、CSRF、限流、偽造店家欄位與 audit 不記錄原始憑證。

`pickup.integration.test.ts` 必須明確設定 `LINE_PLATFORM_TEST_DATABASE_URL`；硬限制 loopback:55722／`stallorder_line_miniapp_20260926`，不 fallback Production。需要四份 20260927 migrations 均套用在指定隔離 clone。用新建合成 fixtures 驗 preview 無 mutation、並行核銷／取消、唯一事件／Billing、跨店／用途、未付款／未完成、改時間／人工備援／重發、逾期延展、key 衝突與 RLS。測試保留合成資料，不改現有商家設定。

本次本機證據：2026-09-27 15:40（Asia/Taipei），上述隔離 DB 13/13 通過；另有 3 個 contract／HTTP／PNG test files 共 10/10 通過，取餐修改範圍 ESLint 通過。DB 案例包含取得第一張圖片前的完成阻擋、建立時未啟用取餐的舊流程相容、Test／Canary 免計費及 UNKNOWN refund 禁止交付。新增真 Session／STAFF／CSRF／HTTP handler 案例先重現停用後 capability=false，再驗證 pilot=false 與 PICKUP_ENABLED=false 下，尚無 QR 的既有 required 訂單仍能由店員有理由首次發行 → 預覽 → 明確交付，完成與 Billing 各一次；未納管舊單不可發行，全平台關閉與缺 CSRF 仍拒絕。這些數字不包含瀏覽器、LINE provider 或實體裝置驗證。

同日 `e2e/line-platform-v2.spec.ts` 在獨立 `https://127.0.0.1:3024` 以明確授權的合成 Session／同一隔離 DB 首輪跑 7/7 通過（1.3 分鐘）：從 MINI 首頁會員導覽入會、選填通知設定持久化、本人跨店清單／店家與歷史篩選、其他已登入會員 HTTP 404、取餐 QR 真實顯圖 512px 且預覽不交付。管理員與門市經理通知 dashboard 實際讀取成功；跨店、一般店員與非平台管理員依既有權限拒絕。一般 Staff 進會員頁顯示 LINE 顧客登入，不顯示不可用的條款流程。會員實際登出後回 MINI，訂單列表與直接詳情只顯登入提示，無先前私人資料或 QR。

Staff 案例從原看板操作：合成 READY／PAID 訂單未發 QR → 關閉本店 pilot → 店員填理由首次發行 → 預覽不改原單 → 勾選實際交付後才 POST 核銷。DB 讀回原訂單 COMPLETED、唯一 LINE_PLATFORM_PICKED_UP、正確店員與 MANUAL 方法。使用完整合成點餐／出勤設定，沿原「稍後處理」關閉開班提示，沒有實際打卡或現金開班。顧客 QR JSON／PNG 均驗 no-store。五頁 × 320／390／768／1440 × light 100%／dark 200% 共 40 種版面組合無水平溢出；成功流程 console／pageerror／非預期 HTTP 錯誤為零。後續整合重現會員表單 hydration 前原生 GET 提交，根因並非僅測試等待；已使用原 useClientReady 在處理器就緒前停用 checkbox 與送出。最終完整 9/9 UI（1.7 分鐘）通過，包括新增的原公開購物車→同瀏覽器合成會員登入→明確匯入；會員舊草稿在匯入確認前保留；另驗一般 Web 自取／外送會員導頁及登出後的草稿隔離。這是本機 Chromium 合成登入證據，未驗真 LINE OAuth、店員相機或正式 HTML cache header（Next dev 使用 revalidation header）。本輪未執行原公開菜單建立訂單的端到端路徑；訂單用隔離 DB 新 fixture，不能代替 intake 全流程證據。

UI 測試須 `LINE_PLATFORM_UI_TEST=true`、`PLAYWRIGHT_APP_URL=https://127.0.0.1:3024`、`PLAYWRIGHT_REUSE_EXISTING_SERVER=true`，再執行 `npx playwright test e2e/line-platform-v2.spec.ts --reporter=line`。測試自身禁止 trace／video／screenshot，並將錯誤中的 media capability 遮罩；既有 3023 人工驗收環境未動。

真實 LINE 卡片顯圖、iPhone／Android／另一台店員掃碼、暗亮度、正式 proxy log 遮罩仍需實機／環境證據；未測不能標 PASS。單元／PNG 測試不是實機驗收。

## 停用及復原

新功能預設關閉：`LINE_PLATFORM_ENABLED`、`LINE_PLATFORM_PICKUP_ENABLED` 及每店 rollout registry。通知旗標與交付分開。不要 destructive down、刪交付紀錄或重設 consumed token。

`LINE_PLATFORM_PICKUP_ENABLED=false` 或關閉某店 pilot 只停止新訂單納管。既有 `pickup_required=true` 或已有 credential 的未結案訂單仍顯示 Staff 入口，允許本人顯圖、受權查詢／發行／重發／預覽／交付；尚未產生第一張 QR 也不會卡住。店員可在「尚未產碼、到期、改時間或遺失：憑證管理」查到版本 0，填原因後按「發行取餐憑證」，再人工核對及明確交付。預覽本身不發行憑證。未 required 且沒有既有 credential 的訂單保持原流程，不因上述例外追溯升級。

`LINE_PLATFORM_ENABLED=false` 才完整關閉平台能力；DB handoff guard 仍保護已納管訂單。完整停機應先核對未交付單並安排受權人工交付，不將舊 checkout 當繞過核銷的緊急後門。金鑰輪替須保留舊材料可解密的安全遷移／受控重發方案，不能換 key 後宣稱舊 QR 仍能重繪。
