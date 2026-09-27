# LINE v2 跨模組獨立審查

2026-09-27，工作樹 `line-miniapp-pay/Stallorder-Platform`，分支 `codex/line-platform-oa-v2-20260927`。這是約 8 分鐘的有界程式路徑審查，不是全功能或正式上線通過證明。原則 read-only；主 Agent 隨後明確授權修復下列 R1 的付款路由／repository 及回歸測試，其餘產品程式未由本審查者修改。

## 發現

### R1 — P1：撤銷 LINE 身分後，舊 Session 仍可操作顧客付款（本輪已修）

主 Agent 提示後核實：原 `src/app/api/payments/line-pay/order/[orderId]/route.ts` 與 `[attemptId]/route.ts` 僅查 `line_platform_order_owners.profile_id/environment`。後者 POST 呼叫 `recover(id,true)`，可能觸發首次 Confirm。原 `line-platform-payment-repository.ts` 的 `reserveCheckout` 只排除已撤銷 member，未排除其 `auth_identities.revoked_at`。

重現条件：顧客有有效本地 Session、既有訂單／attempt；撤銷相應 LINE auth identity，保留 Session。原本人訂單頁會拒絕，但直接呼叫上述付款 API 仍可讀到 payment／進行 recovery；新 checkout 也可能建立 Request。這是顧客權限邊界不一致，與可信背景對帳應繼續無衝突。

修復：三個 customer routes 共用 `requirePaymentOrderOwner` → 原 `requirePlatformOrderOwner`，不存在／撤銷統一 404；新 checkout 短交易 additionally 比對 member environment/provider/subject、join active identity，並 `FOR SHARE` 鎖 member/identity 到 reserve 提交。Callback、商家與 worker 對既有付款的 recovery 不依赖顧客身分存續，保持原有安全對帳。

驗證：customer checkout/status、return、merchant、cron 回歸 **5 files／14 cases PASS**；真 clone DB 各自撤銷 identity、member，確認 fresh checkout 拒絕、沒有 provider request／新 transaction，而 trusted existing recovery 仍可 Check。付款 DB integration **13/13 PASS**，provider HTTP 全是 fixture，非真 Sandbox。

### R2 — P1：停用攤位後，尚未發碼的必核銷訂單失去店員入口（本輪已修）

`src/app/api/line-platform/pickup/[stallSlug]/capability/route.ts:11–18` 僅認 `pilot.enabled` 或已存在未消耗 credential；`LinePlatformPickupPanel` 在 enabled=false 時整個不 render。`member-service.ts` 在下單時即保存 `pickup_required=true`，而 `20260927030000_line_platform_pickup.sql:84–92` 禁止此訂單經原 COMPLETED 路徑繞過 handoff。

重現：pickup 開啟時建立 MINI TAKEOUT；顧客尚未開 QR 卡且通知未發碼；平台管理者停用該攤位；店員 capability 回 false，平台核銷／管理入口消失，普通完成又被 `LINE_PLATFORM_PICKUP_HANDOFF_REQUIRED` 擋住。若顧客另開本人頁成功發碼可能暫時解除入口問題，但店員不能依賴這個未說明的前置動作。

修復與回歸：capability 納入仍待交付的 required owner，理由式 manage version=0 可首次發碼。真 DB／HTTP 及 Staff 瀏覽器已跑 pilot 停用、無既有 QR → 首次發碼 → preview 不交付 → 明確交付 → 原 COMPLETED／唯一事件與計費；未納管舊單仍不授權。

另已修正：PICKUP=false 只停止新增 required 訂單，不切斷既有票据／交付；真 auth+CSRF+DB 案例通過。PLATFORM=false 仍為整體緊急停用，手冊明示其邊界。

### R3 — P2：停用新付款時，顧客的在途付款資訊入口也消失（本輪已修）

`src/app/mini/orders/[orderId]/page.tsx:36` 原本以 `runtime.payEnabled` 包住整個 `LinePlatformPayButton`。關閉新付款後，PENDING_AUTH／UNKNOWN 的狀態查詢與恢復 UI 一起消失，只剩原 `orders.payment_status`（UNKNOWN 可能仍為 UNPAID）。底層 API／worker 雖可對帳，顧客看不到必須等待的付款事實。

修復與回歸：本人詳情頁只要存在 attempt 就保留付款區，allowNewPayment 分別限制新付款。page.test.tsx 覆蓋 gate=false、既有 attempt、required pickup、舊單與非本人；API／DB 驗證既有查核繼續。此處頁面組合測試屬伺服器 component 驗證，沒有真 Sandbox 回跳證據。

### R4 — P2：重發取餐 credential 後，重試通知仍引用已撤銷 QR（本輪已修）

`notification-worker.ts:129–145` 只在第一個 snapshot 建立時呼叫 `ensurePickupMediaForOrder`；`:149–154` 的後續重試只重驗訂單狀態／收件資格，然後推送固定 body。`pickup-service.ts:254–257` REISSUE 撤銷舊 credential，`:279–286` 舊 media 讀取因此 404。

重現：READY 通知首次 push 500／timeout，舊 image URL 已存 snapshot；店員重發 credential，訂單仍 READY；worker 再次 push 同一 snapshot，顧客收到已失效的圖片 URL。改履約時間使舊 credential 撤銷也可能觸發同一路徑。

修復與回歸：推送前重驗 snapshot 引用的 credential／履約版本。失效轉 MANUAL_REVIEW/PICKUP_SNAPSHOT_STALE，body/key/hash 不變且補發被拒。notification.integration.test.ts 真 DB 跑首次 500 → REISSUE → 舊 media 404 → 再次 worker 不發 HTTP。外部 provider 為 fixture。

## 檢查範圍與界線

- **會員／原 intake**：`/api/mini/orders` re-export 原 circuit B；新單 RPC、owner、contact/outbox 在同一 Serializable transaction，owner trigger 要求 active pilot 與 cutover。既有冪等 replay 另綁 owner，但既有 owner 不可換人。檢查 member-service、member migration、circuit-b-service、trusted-rpc-repository 及現有 member integration cases；本輪沒重跑整個原菜單／購物車入口。
- **訪客認領**：guest proof 加密且 AAD 分離；exchange 核對 long tracking hash、CONSUMED original session、device HMAC、同 tenant/stall、撤銷與 pilot；claim 再鎖 order/session，走 immutable owner。Cookie 每筆 tracking 派生名稱，HttpOnly／SameSite Strict，僅加上原追蹤頁可選入口。查看 guest-claim、exchange/claim routes、原 tracker page 及 integration cases，未發現可僅用短取餐碼認領的路徑；此句不代表全面滲透測試通過。
- **通知／付款／核銷**：看原 legacy dispatcher 對 PLATFORM owner 的排除、OA webhook HMAC/destination/environment、持久化 snapshot/lease、資格重驗、pickup 的原 order lock 與 UNKNOWN/refund 阻擋。未重做本人撰寫的金流 protocol／退款配對完整審查。
- **callback／logs**：支付 return/cancel 只以 state hash 解決 attempt，再導向不含 state/provider token 的 protected order URL；錯誤 response 為代碼，circuit B SQL error logger 僅輸出 allowlisted 名稱／SQLState；Next incoming logging 忽略 MINI、media、payment callback，performance URL 清掉 query/hash。未存取 Production/CDN/WAF/Vercel 存取日誌，因此無法宣稱外部 logging 配置已驗證不含 token。
- **未查**：真 LINE Login／OA／Pay Sandbox、iPhone/Android WebView、實體掃碼／列印、正式部署 ACL、真商家對帳、完整舊 QR/Web/其他登入回歸，以及這輪審查後其他 Agent 的變更。

## 既有測試差異保留

原 foundation pgTAP 仍為 **18 PASS／1 FAIL**：clone 已有七個 auth/payment `default_enabled=true`，v2 未修改，沒有為測試改值冒充 default-off。原通知排程依赖 clone 缺 `pg_cron`，**1 SKIP** 仍不算 PASS。詳見 `artifacts/line-v2-core-pgtap-20260927.json`。本審查沒有遠端寫入、發真通知或收退款。

## 最終整合新增修正

- **R5：公開店家連結識別不一致。** 原 resolver 使用 canonical code，MINI 合作店家、訂單「查看本店」及 guest handoff 誤用 Staff slug。已统一為 code；刻意使用 code≠slug 的真 browser 購物車交接驗證，以及兩個頁面的連結回歸。
- **R6：會員表單在 hydration 前可提交。** browser 實際重現只有 GET、没有 PATCH且偏好未保存。沿既有 useClientReady 在處理器準備前停用輸入／送出；SSR 新入會與既有會員兩案例加回歸，瀏覽器重驗真的 PATCH 及 DB 讀回。
- **R7：原接單吞掉 Serializable 衝突。** 精確 clone 診斷取得 40001，診斷 transaction ROLLBACK 並讀回原函式未变。070000 只重新拋出 serialization_failure；平台原交易最多重試兩次，沿相同 order/session/idempotency。最後庫存、失效時段、真 40001 後成功及唯一 owner/stock 均有 DB 案例，外部驗證不重跑。原核心沒有每時段固定名額上限，不宣稱存在。
- **R8：購物車交接歸屬與撤銷。** 原 B Session 發行即綁已登入的平台會員；logout後不能 export 成客人。Consume 鎖 active member/identity；原 owner 綁定與 guest proof 也驗不可變 Session claim。不同會員重放、撤銷競爭與原公開點餐 disabled/invalid 平台設定 fallback 有回歸。

最終合併測試結果以 TEST_REPORT 為準；以上為本機來源與 fixture／DB／browser 證據，沒有真 OA、Pay Sandbox 或硬體完成宣告。
