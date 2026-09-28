# LINE v2 設定、試點與復原

2026-09-27。本頁不授權發布；候選所有新旗標預設關閉。正式主站、DR、3023人工UI都未被本輪替換。

## 先核對真實平台身份

1. OA Manager確認「攤點通平台」OA ID、顯示名、管理人、现有Bot/選單來源。不要直接用越好吃店家OA作平台sender；沒有平台OA就依EXTERNAL_SETUP_CHECKLIST辦理。
2. LINE Developers確認同一正確Provider下的Messaging、LINE Login、MINI內部developing/review/published Channel與LIFF ID。精確記錄環境，linked OA為平台OA。身分只需openid；若另用friendship API依當日官方要求配置profile，不預設Email。
3. 明確自有HTTPS Preview、/mini Endpoint、測試者及安全Session/callback origin。local自簽+假ID只能本機QA，LINE公開抓QR無法用loopback。
4. 分別保存OA access token/secret至原Vault、平台資料加密key及Pay merchant version至server secret管理。不要將值寫入文件、前端或git。

## 程式設定

.env.example提供空白欄位。LINE_PLATFORM_BINDING_JSON為strict JSON：

- environment、providerId、channelId、liffId、internalChannel、endpointUrl（HTTPS，path恰/mini）。
- oaDestination（bot/info的userId）、oaChannelId、oaAccessTokenReference、oaSecretReference（兩個Vault UUID）。
- termsVersion；addFriendUrl可選，僅line.me/lin.ee官方HTTPS。
- LINE_PLATFORM_ENVIRONMENT必須與部署及binding一致。
- Preview/Production另填LINE_PLATFORM_DATABASE_BINDING_JSON：environment及獨立核對DB目標的fingerprint。以server runtime的platformDatabaseFingerprint計算host/port/path/username，不含密碼；不可把錯目標重算後冒充驗證。
- LINE_PLATFORM_DATA_KEY：32-byte Base64。PICKUP_TOKEN_GRACE_MINUTES預設120。
- Pay callback/state secret與每商家versioned env:// reference見PAYMENT_OPERATIONS。

分離開關：LINE_PLATFORM_ENABLED（入口）、LINE_PLATFORM_NOTIFICATIONS_ENABLED（Push）、LINE_PLATFORM_PICKUP_ENABLED（新取餐能力）、LINE_PLATFORM_PAY_ENABLED（新支付）。門市另有enabled/cutover。停止新付款須只關PAY旗標，保留既有恢復；已有pickup_required單不可無交付安排就全關平台。

## Migration與本機驗證

按現有受控migration流程依序套20260927010000～070000。先用隔離clone、查身份/權限/原baseline與回復備份，不能db push或指向Production測試。各真DBtest強制loopback55722/精確DB `stallorder_line_miniapp_20260926`。

本機候選已有相容migration及合成資料。臨時QA可用scripts/start-line-platform-qa.mjs（需要本機.env.local、受限clone、.secrets測試憑證）；此腳本沒有真實Channel/Push/Pay。原3023保持獨立。测试結束停本次3024程序，不停其他工作區容器。

## Preview／雙店驗收

1. 依專案規則先Staging/Preview，capture Primary健康、deployment/alias/backend及明確復原target；單一remote writer。不要觸發DR或主站domain切換。
2. /admin/line-platform由平台管理者同步registry，讀回bot/info與配額；設定Webhook /api/webhooks/line-platform，驗empty events/簽章/destination/重送。先盤點舊Bot設定再改。
3. 只開兩個授權測試門市，保存cutover，原舊單不搬移。正確OA好友/通知同意後跑同會員雙店卡片→READY→preview→交付。
4. LINE Pay先使用各店自己的SANDBOX connection，真Request/授權/Confirm/取消/查核/退款；記每店正確收款身份。沒有正式host適配，不能開LIVE。
5. 遠端通知commit wakeup/pg_net/cron、Pay每分鐘查核cron須驗實際認證、重啟、延遲；local測試沒有證明scheduler正常。
6. 依TEST_REPORT G組實機；缺條件即BLOCKED。所有外部設定/認證分別簽收，不能以OA登入取代Pay或MINI認證。

## 選單

先 `node scripts/line-platform-rich-menu.mjs --example` 與 `npm test -- scripts/line-platform-rich-menu.test.mjs`，零網路。示例JSON不能發布。真實設定重新dry-run，查原Manager/API/per-user覆蓋及備份；精確plan/hash授權後才能apply/restore，詳RICH_MENU_OPERATIONS。歡迎訊息為草稿，未自動發布。

## 回復

先停新單/Pay/個別門市，不刪事件、付款、owner、已用票據或credential version。保留查核及受控交付完成在途單。通知UNKNOWN先用原key/body恢復，超窗口人工；Pay UNKNOWN不重付/盲退。回復已驗健康應用artifact，保留相容schema；讀回Primary/DR/alias/backend、login/Staff及受影響訂單實際流程，再記錄完成。不要把READY或部署成功當全流程證據。


## MINI 下單相依開關

MINI 使用既有 Circuit B 下單入口。非 development 環境須依現有受控 rollout 啟用 `DUAL_ORDER_INTAKE_ENABLED`，並具備原本的 QR session、反濫用驗證、攤位營業／可預約時段與庫存設定；LINE 平台旗標不取代這些檢查。本機測試使用原 development 入口，不修改正式旗標。既有核心未實作「每一取餐時段固定名額上限」；時段合法性與商品库存需分開驗證，不宣稱時段容量預占已存在。

## 2026-09-28 公開測試資源方案（尚未執行）

本節保留申請時的原始方案與授權邊界。使用者之後已核准，PR365／child／單一 HTTPS alias 已建立；下文「尚未建立、需授權」均屬歷史前置狀態，不能再要求相同範圍核准。當前身分／到期及驗證結果以 [執行紀錄](PREVIEW_EXECUTION_20260928.md)、[外部設定清單](EXTERNAL_SETUP_CHECKLIST.md) 及 `artifacts/line-v2-preview-resources.json` 為準。

用途：讓已建立的 Developing MINI App 接入真實 LINE 登入、平台 OA 訊息與 LINE Pay Sandbox；本機自簽環境仍只作合成 QA。本節是資源建立及測試的具體範圍，**不是發布完成收據或 Production 啟用授權**。

### 固定來源與目標

| 項目 | 待執行範圍 |
|---|---|
| Repo／來源 | `KenLeeYa/Stallorder-Platform`；`codex/line-platform-oa-v2-20260927`，候選 `99b1f9d`（LINE 應用基準 `d7d67c7`，其後為文件與 Micro 修正）。後續文件提交不改應用 tree；應用或設定變更仍須重新記錄 QA。 |
| PR | 草稿 PR 以 `staging` 為 base；目前尚未 push／建立。對 staging 的候選包含先前 UI、LINE v1 與 v2，不能把全部差異描述為本次兩行修正，也不能自動 merge。 |
| Supabase | 原 parent `eyuctbnlvnbnivwasvqr`；organization `urxujyhcggjgwsjtleys`（目前顯示名 KuanGuard、Pro）。新建一個 ephemeral data-less Micro，沿用 workflow 的 `pr-<實際PR號>-oauth-delivery` 與 ap-southeast-1；新 project_ref 必須不等於 parent，僅合成雙店資料。 |
| Vercel | 既有 team `team_MMfsiG94K9Zy3e6w7Ccc9xY4`／project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`；僅該候選的 Preview deployment，讀回 target、commit、branch、DB fingerprint 與唯一 HTTPS hostname。普通 Git 自動 Preview 不作驗收。 |
| LINE MINI | Developing `2011762558`／`2011762558-AZbWkGcb`，僅改其 Endpoint 為通過檢查的 `https://<實際Preview主機>/mini`；Review／Published 不啟用。 |
| OA／Pay | 平台 OA `@028sijlm`、Messaging `2011762548`；Pay 僅 Sandbox `2011753464` 綁測試越好吃店。第二店無獨立 Sandbox 資格前只驗現金及拒絕錯帳號，不把第一店金鑰套到第二店。 |

### 憑證與對外入口

現有同意只涵蓋 repo 外本機儲存。後續需明確允許將 OA Token／Secret 匯入這個測試 branch 的 Supabase Vault，以及將 Pay Sandbox Secret、獨立資料加密 key／callback-state key／cron key 注入該 Vercel Preview 的 server runtime。若使用 GitHub 執行器中轉，只允許本 repo 的 `Preview` Environment、exact branch guard；不得寫共用 Production env、前端 bundle、PR body、Actions artifact 或日誌。OA binding JSON 只含 Vault reference，不含原始 Token。

新建分支仍需檢查帶入的 schema／設定／Edge Functions／cron 目的地；data-less 不代表沒有外部呼叫。先停用未核對的測試觸發源，再於新 DB 套受審 migration、合成 fixtures 及專用測試旗標。現有 workflow 的 LINE live 設定屬於舊的員工 Login，不能直接視為 v2 的 registry／Vault／worker 已配置。

Preview authentication 必須與 LINE callback、Webhook、QR PNG 可達性相容；先查該 deployment 的有效保護設定。不能把 Vercel bypass secret 放進公開圖片或 MINI URL；若必須降低 project 共用保護，停止並另提範圍，不能為一個測試站放寬其他部署。僅允許 exact hostname，不增加正式 `*.vercel.app` 或任意 tunnel allowlist。

### 費用與驗收窗口

提案為第一次資源健康後 **24 小時**內驗收，資料庫 Micro 約 **US$0.32／24 小時**運算，其他用量另計。建議本次新增費用管理預算 **US$2**；這不是供應商硬性上限，帳單可能延遲，若預估將超過則停止新增使用並清理。不升級方案、不加席次／PITR／自訂環境。價格與條件見 [官方成本查核](PREVIEW_RESOURCE_COSTS_20260928.md)。

需保留等候手機驗證時，登記實際建立時間、到期時間、資源ID與負責任務；未核准不自動延長。到期先停排程與新測試，再移除這次的 Endpoint／Webhook、測試部署、測試 branch 及中轉 secrets，逐項讀回。先保留脫敏驗收結果；清理只針對這次可拋棄的合成資料與資源，不刪3023、本機測試資料、parent或DR。

### 自動執行順序及停止條件

1. 取得上述資源費用／PR／憑證目的地的範圍同意後，核對 Primary deployment、登入與授權的受影響下單路徑，確認唯一遠端 writer；不沿用過時健康證據。
2. 先通過候選 reviewed migrations、DB／RLS／build／paired Preview gates；任何 gate 失敗只修復候選，不能跳过後啟用。
3. 初始化 v2 registry 與明確 audience／DB fingerprint、讀回 OA bot info；開新平台入口和取餐測試，Push／Pay 先關。通過真 LINE 首次入會、拒絕／重登／切帳號、跨店隔離後才開對應 Push／Pay 測試。
4. 只在使用者指定的測試帳號及同意下限量發訊。需先取得確切測試者，不把控制台管理者 userId 自動當成授權收件者。Webhook 先保存空白原設定，完成簽章與empty events驗證再啟用；歡迎詞／全體選單不自動發布。
5. 跑真正 Sandbox Request→LINE授權→Confirm、取消／返回／查核／退款；再驗真通知卡片→關閉MINI→READY→獨立店員裝置掃碼預覽→交付→PICKED_UP。手機登入／支付操作交由本人，未做不得記PASS。
6. 分列程式、模擬／DB自動化、真LINE、Pay Sandbox、實機掃碼與正式狀態；完成或到期按上述清理。正式啟用另依發布規則與授權，不由草稿PR或此次測試自動進行。

以上是建立前計畫，不能作為目前雲端結果。已確認公開入口為 https://stallorder-line-v2-pr365-20260928.vercel.app ，9/29 06:24 起清理、最晚 07:24 完成；不自動延長。

## 本人手機驗證的接續步驟

2026-09-28 20:31 更新：下列 B002 掃碼腳本已由本人在 iPhone 16 Pro／LINE 26.15.0 完成。店員、顧客與 OA 三端已確認；後端 v2 為 QR 核銷、20:21:20 交付。**B002 已完成，不能再當作未核銷取餐範例，也不需重建或補發。** 若另測重掃，只驗已取餐拒絕；本次沒有實機重掃結果。下列18:31票據期限為歷史發行紀錄，不表示目前仍可交付。iOS 版本未提供。

1. 在原本的 LINE 查看「攤點通 @028sijlm」：核對 A 店 `260928-007` 的 NT$30 訂單卡，以及 B 店 `260928-001` 的訂單、餐點完成、已取餐通知。回報實際收到的種類與店名／金額／圖片是否正確；伺服器 `PROVIDER_ACCEPTED` 不能代替此步。
2. 從 Developing MINI 入口 https://miniapp.line.me/2011762558-AZbWkGcb 進入「我的訂單」。仍需持有原本人 LINE Session，不能以店員帳號覆蓋它。
3. A 店 `260928-007` 已於15:44由本人完成 Sandbox 授權及 Confirm，15:49全額退款 NT$30。QR已由原退款交易撤銷，不能再用 A007 測試取餐；舊逾時付款 QR 同樣不再使用。沒有真實收退款。
4. 改用 B 店 `260928-002`：READY／合成現金 PAID，沒有交付事件。顧客繼續用LINE；店員使用另一支裝置或獨立Chrome Session，直接開啟 **[B店員工登入](https://stallorder-line-v2-pr365-20260928.vercel.app/staff/login?next=%2Fstaff%2Fline-preview-store-b)**，選電子郵件與密碼，使用B店測試帳號。不要使用顧客LINE身分進店員頁：顧客没有本店權限，直接開 `/staff/line-preview-store-b` 會被權限邊界以404拒絕；這不代表網址或手機版不存在。登入後返回B店看板。不能使用3023／Production或A店員帳號；限定B店帳號位於repo外受限 `C:/Users/KY/.codex/private/stallorder-line-test/PR365_DEVICE_PICKUP_GUIDE.md`，不公開憑證。
5. B002 原QR v1於9/28 17:30到期；18:31已透過正常商家補發API產生v2，有效至今日23:00，舊v1已撤銷。不可再用舊碼判斷相機功能；此次沒有直接改DB延長期限。顧客在「我的訂單」開有效測試訂單的「顯示／更新取餐 QR」。店員點「平台 QR 掃碼交付」→「開啟相機掃描」→「預覽餐點與付款」。只預覽時不交付，核對店名／單號／份數／付款後模擬交付。確認顧客已取餐、OA通知及重掃不重複交付。若過期，透過原憑證管理正常重發並撤銷舊碼，不直接改DB延長。保留 OS／LINE版本及時間；未操作鏡頭維持NOT_RUN。
6. A店全額退款及官方明細已驗證。部分退款因原交易能力快照為false仍未驗；兩間店獨立 Pay 收款仍需要B店自己的Sandbox商家，不挪用A店金鑰。
