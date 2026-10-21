# 顧客營業時間卡控與本機環境 — 2026-10-02

本機修正已實作並驗證；未發布正式環境。唯一測試 lab 為 stallorder-responsive-20260930，DB56822、API56821。使用者要求保留人工 QA，因此七個必要容器與 App 保留，不新增第二個 Docker lab。

## 修正與適用流程

外送菜單不再固定標示可接單，公開連結也使用營業時間狀態。QR／公開店家／MINI 的既有顧客流程共用 canonical preflight 與最終建單檢查；DEFAULT、DELIVERY 依伺服器當下時間檢查設定時段、最後接單、臨時休業、出攤行程／活動。最終檢查在既有鎖與重播辨識後執行，避免只在開啟菜單時檢查。已成立訂單的合法重播保留。

PREORDER 按選定的未來營業時段檢查；今天休業仍可選合法未來時段，休業的預約時段不可送單。店員即時 POS 保留原本受權人工建單語意，並非顧客公開下單的營業時間限制；既有訂單編輯亦未增加新的時段限制。未設定週營業時間維持既有政策，並非自動視為休業；已設定但當日缺時段／全部休業則拒絕。臨時營業設定依既有同日限制，未新增跨日設定功能。

## 本次證據

證據目錄：`.superpowers/sdd/2026-10-01-awesome-optimization/business-hours-fix/`。

- 聚焦測試 5 檔／54 案例 PASS；變更 TS 的 ESLint exit0。
- 已核准 hash 的 additive SQL migration 本機 apply exit0；原三函式 ACL／metadata 與其餘 schema guard 不變。未修改 migration history。
- calendar helper 回滾測試 PASS：週時段、跨午夜、截止、缺少當日、全休、24小時、臨時休業／時段、行程與活動起訖；六個 scoped 完整資料集合回滾後一致。
- 實際 canonical preflight、session issuer、最終 daily-pickup wrapper 回滾測試 v2 exit0：DEFAULT／DELIVERY 開店取得 session、關店拒絕且 session 未消耗、重新開店成功建单；關店後合法重播不變。DELIVERY 有效未來送達時間也不能繞過當下停止接單。PREORDER 未來休業時段兩個 gate 拒絕、有效未來建單及重播成功。三筆交易內訂單全部 ROLLBACK。v1 fixture-settings 失敗保留，未放寬權限／限流／計費。
- 真 HTTP A（Edge）／B（Node）各 DEFAULT、DELIVERY 開店 session201；關店 session409／STALL_CLOSED；開店 session 取得後關店送單409／STALL_CLOSED。兩 circuit 今天休業仍提供合法未來 PREORDER slots。沒有建立 HTTP 測試訂單；精確刪除本輪 temporary QR／session／attempt，營業時間完整行讀回已還原。
- Chromium390px QR 與公開外送入口呈現「目前非營業時間」。正常瀏覽器 A session201，以及只中斷 A session request 後 B fallback201，點餐計時介面可見。
- 四個正常 seed 帳密 UI 登入後的 Admin／Staff／Merchant／Kitchen 授權頁可見。多組織帳號可能先進選擇頁；測試再进入明確受權工作區。登入 smoke 的舊登出觀測與 API-cookie 腳本失敗未當作 PASS；本輪僅驗證登入與授權入口。
- 真 MINI LINE 身分、原生／實機、Staff POS 建單、既有訂單編輯與雙連線鎖等待競態 NOT_RUN；共享底層 guard 已測不代表供應商端實機通過。

## 可用本機入口與版本

- 登入：`http://127.0.0.1:3026/login`；店員：`http://127.0.0.1:3026/staff/aming-chicken`。
- 顧客外送：`http://127.0.0.1:3026/store/aming-01?view=delivery`；菜單：`http://127.0.0.1:3026/store/aming-01?view=menu`。
- 商家營業時間：`http://127.0.0.1:3026/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/business-hours`。
- 使用既有 owner／staff／kitchen／platform.admin @stallorder.test seed 帳號，測試密碼沿用 prisma/seed.ts。獨立／私密瀏覽器 profile，避免 3023 相同 hostname cookies 共用。

新 build `FuWga8IkNOjvtzXvUJfQJ`，完整 Next build／TypeScript exit0；來源 SHA `8c857174eadf4005a272fc512bf62fc89195058b7eaedc197239729684536a01`，本輪來源凍結讀回一致。保留前面的 B6a 草稿，不宣稱意見回饋 schema 已套用或整體 Awesome 完成。

入口3026是只接受loopback socket的本機 proxy，Next upstream只綁127.0.0.1:3027。以實際 socket IP覆寫代理IP欄位，保留正式API來源卡控；不信任傳入的代理IP，不放寬應用程式Origin或授權。程序 wrapper23584／Next24424，精確讀回在 runtime-process.json；未來 PID可能不同，停止前再次驗證。恢復指令為本工作樹 `node .superpowers/sdd/2026-10-01-awesome-optimization/business-hours-fix/start-manual.cjs`，啟動前核對兩port無其他consumer及build provenance。

DUAL_ORDER_INTAKE_ENABLED 經正常平台管理員／CSRF API限時續期，唯一 GLOBAL override讀回启用至2026-10-03 00:53:24.637（台北）。不永久啟用、不自動續期。既有本機阿明營業時間目前七天24小時；手測關店需從商家設定合法時段或休業日，不能把24小時測試設定誤判為卡控失效。

正式站唯讀deployment仍為 dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ／5cc15c6a6189cfd56e127676bc5228e9ffd2ff56 READY Production。本輪沒有正式發布、遠端schema／設定／通知／付款操作；正式顧客完整流程未驗證，不宣稱正式已修复。
