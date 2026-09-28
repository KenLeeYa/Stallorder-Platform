# LINE v2 測試報告

日期：2026-09-27（Asia/Taipei）。基準需求為 requirements/prompt-v2-20260927.md。使用本機隔離 clone、合成顧客/店員/兩店；真DB並不等於真LINE。所有外部provider成功回應除明示控制台登入外皆為fixture。

## 執行摘要

最終本機結果：**615 個單元／API 回歸、88 個真 DB 整合、9 個瀏覽器流程、12 個 Rich Menu 工具案例通過**。TypeScript 與正式模式建置通過（113 頁生成）。變更範圍原 150 檔及最後 7 檔（其中 2 檔新增）ESLint 無錯誤，保留原 public-order-tracker 第 881 行導頁警告 1 個。

Unit 模式的 97 個 SKIP 中，88 個已由受限 clone 專用 runner 通過；其餘 9 個原 Circuit A/B replay／terminal cases 需要原 56322／Edge replay stack，本次未啟動，不能算 PASS。原 SQL 基線仍有下述 1 FAIL／1 SKIP。全需求尚有外部 BLOCKED 與部分回歸缺口，**不是整體功能／正式啟用驗收完成**。

最終瀏覽器包含 code≠slug 的原訪客購物車→本機合成會員登入→明確匯入、會員通知設定 PATCH／持久化、跨店本人訂單及他人 404、原 Staff 明確交付、登出隱私、平台／門市權限與 40 種版面組合。另驗自取／外送的原 Web 入口→有效會員導同店 MINI→本人草稿隔離→真登出後原訪客草稿仍在。沒有用假成功回應代替真 LINE 身分或真 Sandbox 授權。

最後新增原公開 API 的真 AuthSession cookie → /api/public/order-session → /api/public/orders 測試：沿原交易建立唯一 owner／contact；原確認狀態轉移後有唯一通知事件。匿名、非試點、停用、cutover 前與 optional 設定錯誤保留原 Web；已綁 Session 換會員或登出使用會拒絕，沒有建單或扣庫存。這是實際 API／DB 的接單證據；完整瀏覽器建單及真 LINE 付款仍不可由草稿測試替代。

Gitleaks 檢查原 187 個本次檔案：2 個命中均逐項確認為測試 UUID／明示 synthetic state key，未發現實際憑證；最後 7 個補強檔另掃描為 0 命中。建置後另比對 3 個本機私有設定值與 153 個 client 檔案，0 命中。這不代表正式 CDN／APM 日誌已驗證。

已確認外部 Sandbox 帳號可登入，尚未執行任何 Sandbox API 收退款；平台 OA、真 MINI 和實機未驗。

原SQL回歸：KDS 32/32、online payment reconciliation 46/46、PAYG 39/39、LINE 33PASS/1schedulerSKIP、foundation18PASS/1FAIL。Foundation失敗是clone原有七個開啟旗標與舊default-off斷言不一致，未改旗標掩蓋。五批均ROLLBACK並讀回固定fixture0。

Clone曾因restore owner/ACL缺漏出現summary-date、permission錯誤；按原migration恢复原grant/functionowner，未放寬v2 private snapshot。artifact line-v2-core-pgtap-20260927.json保留前後結果；line-v2-clone-baseline-repair.sql僅clone修復，不是Productionmigration。

## 2026-09-28 外部設定與 Preview 準備增量

- 平台 OA／Messaging API 及 Developing／Review／Published MINI App 實際建立／讀回完成；MINI linked OA、openid/profile及一般加好友提示已保存，Endpoint仍為LINE範例頁。OA身份、訊息格式與配額使用官方API；Pay僅執行官方Sandbox唯讀查詢，詳 [設定收據](PROVIDER_SETUP_RECEIPT_20260928.md)。
- 本機設定格式七項通過；沒有傳送真實Push，沒有Pay Request／Confirm／退款或實機核銷。上方2026-09-27的應用測試結果沒有改記為真provider成功。
- `99b1f9d` 將隔離 Preview 建立規格 Nano 改 Micro。既有workflow契約先出現1項預期失敗，修正後執行 `npm exec -- vitest run scripts/lib/production-workflow-contract.test.mjs --reporter=dot`，30項通過、0失敗／0跳過。未執行雲端建立，不視為雲端QA成功。
- 本次沒有啟動服務或遠端部署；原3023／共用55722保留供人工QA，3024仍停止。後續需依 [隔離資源方案](SETUP_RUNBOOK.md#2026-09-28-公開測試資源方案尚未執行) 取得資源及憑證目的地授權。

## 測試命令與範圍

```powershell
node scripts/run-line-platform-qa.mjs unit
node scripts/run-line-platform-qa.mjs database
node scripts/run-line-platform-qa.mjs browser
npm test -- scripts/line-platform-rich-menu.test.mjs
npm run typecheck
npm run build
```

- Unit 模式不接 DB；另列跳過的 integration。Database 模式硬性核對 localhost／127.0.0.1:55722 與 `stallorder_line_miniapp_20260926`，序列執行，避免共用 registry 的 fixture 互相干擾。
- Browser 需先在此工作樹執行 `node scripts/start-line-platform-qa.mjs`，使用既有 `.env.local`、專用 clone 及 `.secrets/line-qa-key.pem`／`line-qa-cert.pem`。憑證只供本機合成 HTTPS；Playwright 明確忽略該測試憑證，不更改電腦信任設定。不可拿這個假 Channel 當真 LINE 入口。
- Build 前必須停同一工作樹的 3024，避免共用 `.next`；3023 是另一工作樹，不切换它。
- 另執行變更範圍 ESLint 與 Gitleaks；結果與待測項見執行摘要。

## A–F：94 項逐項對照

PASS表示該列已列出的本機自動化範圍成立；要求真provider/装置的列仍標BLOCKED。NOT_RUN為本次還沒有足夠完整證據；局部單元通過不冒充全案例。

| ID | 狀態 | 本次證據／缺口 |
|---|---|---|
| A01 | BLOCKED | identity/login integration 的官方 verify fixture與原Session通過；真實Channel/LINE授權未驗 |
| A02 | PASS | identity/challenge：偽造、期限、issuer、audience拒絕（合成provider） |
| A03 | PASS | member-contract/runtime：deploy、Published/audience環境不相容拒絕 |
| A04 | PASS | identity/API strict input忽略或拒絕role、subject、tenant注入 |
| A05 | PASS | Provider namespace及identity fixture；不以Email合併 |
| A06 | PASS | 真 DB/API 與 browser：同授權訪客、同店、10 分鐘 sealed 草稿、明確匯入；既有會員草稿確認前保留，跨會員/店/裝置/撤銷/過期拒絕（登入身分為合成） |
| A07 | BLOCKED | 本機logout及異會員/店草稿隔離；真LINE切帳號/重開未驗 |
| A08 | PASS | member/pickup/payment/notification API+DB跨owner/店別拒絕；私有表RLS |
| A09 | PASS | 原challenge並行/重放/CSRF/flow/session rotation測試 |
| A10 | BLOCKED | SDK失敗可重試、公開Web fallback有測試；真LINE拒權/無LINE未驗 |
| B01 | BLOCKED | 真Sandbox未執行；Request→Confirm→原payment僅fixture DB證據 |
| B02 | PASS | workflow+DB PENDING_AUTH不入帳 |
| B03 | PASS | line-pay-v4獨立Check endpoint語意 |
| B04 | PASS | HTTP200 API error不視付款成功 |
| B05 | PASS | API expectedAmount/version與server金額驗證；原intake價格regression |
| B06 | PASS | 付款operation key/fingerprint、真DB併發/唯一activeattempt |
| B07 | PASS | return state/交易ID/商家snapshot驗證、無Session不披露 |
| B08 | PASS | callback/恢復/lease-fence DB與workflow fixture |
| B09 | PASS | cancel只查證、不覆蓋已確認PAID；fixture |
| B10 | PASS | Request UNKNOWN無ID進人工，不再Request |
| B11 | PASS | Confirm未知以Check/Details恢復、唯一付款 |
| B12 | PASS | 外部成功/本地提交失敗、租約接管/過時fence拒絕 |
| B13 | PASS | raw parser→原DB→return/API19位ID字串 |
| B14 | PASS | HMAC固定向量/POST單次序列化/GET query |
| B15 | PASS | 整數金額、折扣合計/極值無溢位 |
| B16 | PARTIAL | 真 Circuit B 最後庫存不超賣、失效時段拒絕、40001 有限重試、owner/stock 一次；原核心沒有每時段名額上限，真 Pay 全鏈仍待 Sandbox |
| B17 | PASS | UNKNOWN SQL guard不允許到期/取消/釋資源 |
| B18 | PASS | 原單取消/不符金額保留外部付款事實與人工案件，不復活 |
| B19 | PASS | immutable商家/Channel/secretReference版本DB測試 |
| B20 | PASS | 已存在payment/第二成功證據保留人工超收案件 |
| B21 | PASS | 未定付款SQL禁止現金重付/直接完成 |
| B22 | PASS | stop新Pay不影響existing恢復；缺設定fail closed |
| C01 | BLOCKED | 全/部分退款fixture及DB；真Sandbox退款未驗 |
| C02 | PASS | 退款幂等/並行/超額及保留餘額DB |
| C03 | PASS | UNKNOWN退款保留/Details匹配或人工，不盲重送 |
| C04 | PASS | 商家退款權限/本店/CSRF及audit摘要 |
| C05 | PASS | raw body HMAC、destination、missing/wrong signature、empty events |
| C06 | PASS | webhook event去重、時間/同時unfollow規則 |
| C07 | BLOCKED | quota/error/friend抑制fixture；真封鎖/收訊未驗 |
| C08 | BLOCKED | 程式僅平台OA Push、不呼叫ServiceMessage；真普通Push未驗 |
| C09 | PASS | bot/info不符OA、未知quota、credential用途/配置拒絕fixture |
| C10 | PASS | legacy worker候選和I/O前排除platformowner；DBscope禁止改綁 |
| C11 | PASS | 原完成單計費/全退唯一沖銷真DB；PAYG pgTAP |
| C12 | BLOCKED | print API/offline unit+KDS唯一事件；實體列印/離線回應遺失未驗 |
| C13 | PARTIAL | 原 public fallback/client/checkout/auth 及 SQL 回歸；原 56322/Edge replay 9 案未跑，完整 QR/Web/Google/Apple 真登入與實際列印待驗 |
| C14 | BLOCKED | Rich Menu dry-run/plan/apply/restore contract12PASS；真Manager/現有選單apply未做 |
| C15 | PASS | Preview DB fingerprint/Published audience/productionhost/Payhost拒絕 |
| C16 | PASS | stop switch保留inflight、worker重啟/lease/fence/超窗人工本機測試 |
| C17 | BLOCKED | CSRF/redirect/input/API負向本機；真WAF/callback邊缘未驗 |
| C18 | PARTIAL | Gitleaks 187 檔兩個測試 fixture 命中已核對，client 153 檔無私有設定；正式 CDN/APM 存取日誌與真 QR cache 仍待驗 |
| D01 | PASS | 明確當前terms/選填consent/時間與不建staff，DB+瀏覽器 |
| D02 | PASS | identity唯一/原登入並行與member upsert |
| D03 | PASS | UNKNOWN/拒consent不當eligible，本人頁仍可查 |
| D04 | PASS | 不使用friendship_status_changed猜好友；以signed事件狀態 |
| D05 | PASS | 先follow最小事件、入會後有效單綁定；後follow只恢復有效近期通知 |
| D06 | BLOCKED | 同會員雙店owner/list/同sender fixture；真人雙店消息未驗 |
| D07 | PASS | 本人跨店/filter/history與另會員404，DB+瀏覽器 |
| D08 | PASS | 通知/金流本店RBAC，沒有商家可查全平台好友入口 |
| D09 | PASS | env/Provider namespace，不以相同email/phone合併 |
| D10 | PASS | session+device+tracking+proof，短碼/他人QR/跨店session拒绝 |
| D11 | PASS | owner/recipient immutable，撤銷會員/identity發送前再查 |
| D12 | PASS | signed webhook timestamp/version防舊follow覆蓋unfollow |
| E01 | PASS | 真KDS核心→ordersREADY+唯一outbox同交易 |
| E02 | PASS | 原nonKDS PATCH API/CSRF/DB→唯一READY事件 |
| E03 | PASS | 原 KDS/品項狀態與實際 amendment API 真 DB：部分/PACKING 不誤發、刪除品項後依剩餘品項推進整單 READY |
| E04 | PASS | 付款/print不寫PICKED_UP，凍結required DBguard |
| E05 | PASS | 雙KDS/非KDS併發/replay、唯一READY/outbox，無額外billing |
| E06 | BLOCKED | 自有512PNG與jsQR獨立decode本機通過；LINE實際顯圖/另機掃未驗 |
| E07 | PASS | 圖片GET只PNG、匿名preview無授權、preview不mutation |
| E08 | BLOCKED | Staff真UI人工preview→explicitPOST+DB通過；相機掃碼未驗 |
| E09 | PASS | 真DB並行/replay唯一交付/事件/Billing |
| E10 | PASS | 他店/同org異店/未登入API和DB拒絕 |
| E11 | PASS | expired/revoked/cancelled/used/forged credential contract+DB |
| E12 | PASS | 改履約時間/版本撤銷、有界延期/隔日基準contract+DB |
| E13 | PASS | 未收現金/UNKNOWN payment或refund禁止交付 |
| E14 | PASS | 原order lock的取消/退款/交付競爭DB |
| E15 | BLOCKED | 人工交付/原因/重發撤銷DB及UI；真相機拒權未驗 |
| E16 | BLOCKED | purpose/hash/revocation/oldmedia本機；LINE快取與轉傳真人情境未驗 |
| F01 | BLOCKED | 雙店同registry/卡片fixture；真平台OA發送未驗 |
| F02 | BLOCKED | 後端outbox/worker具備；閉MINI真Push/遠端scheduler未驗 |
| F03 | BLOCKED | 三種原事件獨立DB證據；真三階段LINE訊息未驗 |
| F04 | PASS | 原owner/payment/confirmed入口去重為receipt |
| F05 | PASS | 取消/取餐前抑制過時READY，fixture DB |
| F06 | PASS | transaction rollback/commit、worker lease重啟DB |
| F07 | PASS | timeout後原body/key→409 accepted恢復fixture |
| F08 | PASS | immutable snapshot、24h人工、不可換recipient/body |
| F09 | PASS | 400/401/5xx/速率429/quota分類與有限退避 |
| F10 | PASS | UI最多PROVIDER_ACCEPTED，不宣稱delivered/read |
| F11 | PASS | 全局quota/claim保留、每店一件/READYpriority/跨店前進DB |
| F12 | PASS | 本店RBAC/CSRF/冷卻、同時retry僅一、過時READY/accepted禁補 |
| F13 | PASS | 長名/Emoji、固定Flex模板/URL、同源QR插值與scope |
| F14 | BLOCKED | 即時詳情/舊QR撤銷/新舊snapshot本機；LINE舊泡泡快取未實機 |
| F15 | PASS | strict input拒任意to/sender/template；group事件不讀訂單 |
| F16 | BLOCKED | localstop/legacy隔離；真新舊Bot切換及平台Push停啟未驗 |

## G：實機與外部（全部 BLOCKED）

| 場景 | 缺少的本次證據 |
|---|---|
| iPhone LINE 首次入會/深連結/Pay返回 | 裝置OS/LINE版本、授權Channel與真實身份 |
| Android LINE 同上 | 同上；歷史OPPO Web Push不算LINE測試 |
| Safari/Chrome 沒LINE、拒權、Session清空返回 | 真身份與公開Preview |
| 顧客閉MINI後收到READY | 同一平台OA送達畫面、事件至API首次延遲 |
| LINE Flex內QR另機掃/預覽/交付 | 公開自有HTTPS圖片、獨立staff相機 |
| 同會員A/B兩店、各店獨立Sandbox收款 | 雙店連線/帳戶映射及兩組實際交易 |
| 顧客B/店A負向、封鎖、弱網、相機拒權 | 本機負向有局部證據，仍缺真人流程 |

## 完成與服務邊界

- 程式：本機候選；最終diff/整合審查見INTEGRATION_REVIEW。
- 自動化：以上可执行證據；全需求仍有NOT_RUN與已知baseline FAIL，不稱全部通過。
- 真實OA訊息：BLOCKED。沒有冒稱顧客收到。
- Pay Sandbox：帳號登入PASS，API交易BLOCKED。沒有實際收退款。
- 實機掃碼：BLOCKED。真PNG解碼/人工交付不是相機證據。
- 正式啟用：NOT_RUN。Primary/DR未寫，PayLIVE不可用。
- 3024為本次臨時QA程序，完成後停；3023與shared55722容器因人工QA保留。最終讀回：3024 已無 listener；3023 PID 49312、55722 共用容器仍保留。

## 收據與失敗保留

- `artifacts/line-v2-unit-results.json`：108 個檔案通過、12 個有條件跳過；615 PASS／97 SKIP。
- `artifacts/line-v2-database-results.json`：最終 10 檔／88 PASS。首輪曾誤收集暫存掃描目錄內的複本而出現 2 import 失敗；已將副本移至系統 Temp 並讓 runner 排除 artifacts，再以原始 9 檔重跑通過，最後加入原 Web 會員接單 8 案並全量重跑。未將失敗輪算入通過數。
- 瀏覽器 `e2e/line-platform-v2.spec.ts`：最終 9/9，1.7 分鐘。前期 hydration、canonical code、Next route props 及原 Web 會員入口問題均修復後重驗。
- `line-v2-build.txt`、`line-v2-lint.txt`、`line-v2-secret-scan.json`／`line-v2-secret-review.json`、`line-v2-client-secret-check.json` 保留本機結果。
- 七份 migration 僅指定 clone 套用；fixtures 保留，不複製進正式。原 3023 人工測試版本未切換為此候選。

## 2026-09-28 隔離 Preview 增量

- 使用者已授權最長24小時的單一隔離測試站；草稿PR #365，無merge／Production。資源、到期清理及各次CI結果見 [執行紀錄](PREVIEW_EXECUTION_20260928.md)。
- 首次雲端child資料庫72個SQL檔／1,619項pgTAP PASS、schema lint無錯誤；後續commit取消未完成的部署步驟，整輪CANCELLED不算部署成功。
- 修正Rich Menu測試執行器後，本機完整unit 591檔／3,553項 PASS，12檔／97項 SKIP。保留原12個Rich Menu案例與斷言。此結果不代替DB integration、真LINE、Pay Sandbox及實機掃碼。
- 新HEAD的CI、公開Preview、真provider與裝置驗收仍待後續收據；上方既有本機失敗／外部BLOCKED紀錄未改標PASS。
- `5e005cd` 配對Preview `36360718506`已成功：72 SQL／1,619 pgTAP、schema lint、build、read-only與合成OAuth/delivery smoke通過，部署仍受保護；真LINE/Pay旗標關閉。相同HEAD的CI在舊導覽E2E失敗（62 PASS、2 FAIL、其餘未跑），修正為展開系統設定及實際點手機功能目錄後，聚焦2項PASS、lint/typecheck PASS；完整CI待重驗。
- 帳務／手機導覽本機Circuit B回歸7項流程斷言PASS（2.3分鐘）；dev仍記錄JSON解析／串流錯誤，屬尚待正式建置模式CI核對的限制。之前兩輪失敗仍保留，不以最終流程斷言PASS覆蓋錯誤日誌或宣稱整體無錯。
