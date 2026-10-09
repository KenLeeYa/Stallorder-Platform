# 控制登錄

以指定Prompt的T01–T70為索引，逐項綁定適用性、責任、程式、測試、證據與殘餘。PASS僅表示本列明確界定的本機範圍；法律/雲端/硬體/發布另行核定。PARTIAL與BLOCKED均不是完成。全部新控制rollout OFF，既有線上版本不能由候選HEAD推定。完整欄位與source SHA256見[CONTROL_REGISTER.json](CONTROL_REGISTER.json)，候選樹見[SOURCE_INVENTORY.json](SOURCE_INVENTORY.json)。

| ID | 適用性 | 程式 | 驗證 | 責任及殘餘 |
|---|---|---|---|---|
| T01 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機scope/RLS及manager測試通過；尚未逐角色重跑所有hosted查改取消重印入口。 E03/E08 |
| T02 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機scope/RLS及manager測試通過；尚未逐角色重跑所有hosted查改取消重印入口。 E03/E08 |
| T03 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機scope/RLS及manager測試通過；尚未逐角色重跑所有hosted查改取消重印入口。 E03/E08 |
| T04 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機scope/RLS及manager測試通過；尚未逐角色重跑所有hosted查改取消重印入口。 E03/E08 |
| T05 | REQUIRED | IMPLEMENTED | PASS | 工程/資安；本機實際複合FK拒絕跨租戶；Production migration尚未套用。 E03/E12 |
| T06 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；實際本機postgres/service_role為BYPASSRLS；不能將service-role操作當成RLS有效性證明；全view/RPC/policy組合與雲端角色另驗。 E03/E08 |
| T07 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；實際本機postgres/service_role為BYPASSRLS；不能將service-role操作當成RLS有效性證明；全view/RPC/policy組合與雲端角色另驗。 E03/E08 |
| T08 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；實際本機postgres/service_role為BYPASSRLS；不能將service-role操作當成RLS有效性證明；全view/RPC/policy組合與雲端角色另驗。 E03/E08 |
| T09 | REQUIRED | IMPLEMENTED | PASS | 工程/資安；真實Prisma pool交錯/rollback後SET LOCAL context未殘留；只涵蓋新增治理交易入口。 E03 |
| T10 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；SQL與本機service控制通過；Storage CRUD、broadcast/presence與撤權重連尚缺hosted使用者證據。 E08 |
| T11 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；SQL與本機service控制通過；Storage CRUD、broadcast/presence與撤權重連尚缺hosted使用者證據。 E08 |
| T12 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；本人profile投影及CSV控制本機通過；所有角色/報表欄位負矩陣未全部重跑。 E03/E07 |
| T13 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；沿用Supply Lite scope與收貨；沒有新增完整跨企業OMO。Supplier共享/撤銷實際商用關係仍須依已存在能力驗證。 E16 |
| T14 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；沿用Supply Lite scope與收貨；沒有新增完整跨企業OMO。Supplier共享/撤銷實際商用關係仍須依已存在能力驗證。 E16 |
| T15 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；本機session/metadata/撤權與到期負案通過；provider端撤權通知另列外部。 E04 |
| T16 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；本機session/metadata/撤權與到期負案通過；provider端撤權通知另列外部。 E04 |
| T17 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；驗證簽章/claims/顯式linking/return URL本機契約；正式provider client設定尚未驗證。 E04 |
| T18 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；驗證簽章/claims/顯式linking/return URL本機契約；正式provider client設定尚未驗證。 E04 |
| T19 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；驗證簽章/claims/顯式linking/return URL本機契約；正式provider client設定尚未驗證。 E04 |
| T20 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；新增privacy/support有signed proof/action/content/session/單次與5分鐘限制；未全面套用所有既有管理/收款異動入口；真實MFA綁定仍待整合。 E04 |
| T21 | REQUIRED | IMPLEMENTED | PASS | 工程/資安；實際support無grant拒絕、期限/撤銷立即失效、禁MANAGE、自批拒絕、actual/effective actor均保持支援人員。 E04 |
| T22 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；沿用既有帳戶link/unlink控制；新MFA的供應商recovery/最後owner實際恢復演練未完成。 E04 |
| T23 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；本機訪客canonical token/device/限流/最小回應與狀態權限契約通過；實際origin部署驗證另列。 E08/E13 |
| T24 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；本機訪客canonical token/device/限流/最小回應與狀態權限契約通過；實際origin部署驗證另列。 E08/E13 |
| T25 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；purpose/consent SQL與發送邊界本機通過；真實已送/待送provider撤回及跨用途盤點待驗。 E01/E10 |
| T26 | REQUIRED | IMPLEMENTED | PASS | 工程/資安；版本不可改寫與approved/effective policy gate本機通過；正式政策未核定/未seed。 E01 |
| T27 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；可用本人profile/單筆核對order範圍；不等於全帳戶所有資料與所有來源的權利履行。 E01/E04/E07 |
| T28 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；15/30日、延長上限、書面證據及complaint不得展延均通過；自動提醒dispatcher/實際送達尚未接通。 E01/E15 |
| T29 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；終態order聯絡/print/notification/export四類實際執行、hold保全/財務保留通過；其餘五類及全帳戶明確BLOCKED，保留政策待法務會計核准。 E02/E07 |
| T30 | CONDITIONAL | PARTIAL | BLOCKED | 工程/資安；終態order聯絡/print/notification/export四類實際執行、hold保全/財務保留通過；其餘五類及全帳戶明確BLOCKED，保留政策待法務會計核准。 E02/E07 |
| T31 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；11筆合成訂單還原、4個tombstone/1筆erasure保留並撤銷應用session/device/grant；較新的獨立feed、檔案、外部key未驗。 E05/E11 |
| T32 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；新增治理actual DB失敗回滾通過；既有其他高風險service尚須逐共享路徑證明全部audit原子性，不把一般best-effort log改稱強保證。 E06/E17 |
| T33 | REQUIRED | IMPLEMENTED | PASS | 工程/資安；提交後不可UPDATE/DELETE/TRUNCATE；同交易含subtransaction合法補快照不被誤擋；DB owner關閉trigger風險仍需獨立封存。 E03/E06 |
| T34 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；真實Ed25519批次簽章/順序/重複/截斷驗證通過；dispatcher、獨立checkpoint/WORM與延遲告警未配置及未實作外部串接。 E06/E15 |
| T35 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；repo/本機bundle掃描及必要metadata遮罩；11個PEM標頭literal另有逐筆誤報判定。外部CI/runtime/error平台、完整PII與歷史Git objects未覆蓋。 E05/E16/E17 |
| T36 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；本次入口完整destinations負案與credential allowlist通過；其他歷史launcher未全面轉換，基建egress非此env helper可保證。 E13 |
| T37 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機Origin/proxy header/canonical service保護通過；direct Vercel/Edge/Cloudflare真實路徑負案尚未做。 E08/E13 |
| T38 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機Origin/proxy header/canonical service保護通過；direct Vercel/Edge/Cloudflare真實路徑負案尚未做。 E08/E13 |
| T39 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；strict body/CSRF及新API實際越權負案通過；不是全站XSS/SQL/command/template injection掃描證明。 E17 |
| T40 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；私網/metadata/IPv6映射IP/CGNAT分類已修補；現有developer dispatcher disabled，DNS pinning/redirect實際出站仍待完整dispatcher實測。 E13 |
| T41 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；本機MIME/大小/像素/解碼與圖片流程負案通過；hosted Storage授權見T10。 E08 |
| T42 | REQUIRED | IMPLEMENTED | PASS | 工程/資安；LF/VT/BOM等前綴formula注入先紅後綠，正常CSV/匯入契約回歸通過。 E17 |
| T43 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；新增privacy實際HTTP no-store與existing cache策略通過；hosted CDN/RSC/Preview及裝置SW全組合未驗。 E08/E14 |
| T44 | REQUIRED | IMPLEMENTED | PASS | 工程/資安；DB當次授權/TTL/撤銷查核與實際撤銷後讀取拒絕；複本只限已實作投影，不提供無法撤銷的外部signed URL。 E04/E07 |
| T45 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；本機配額/依賴故障分級與dispatcher負案通過；真實同NAT負載、封存告警與provider outage演練待驗。 E06/E13/E15 |
| T46 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；本機配額/依賴故障分級與dispatcher負案通過；真實同NAT負載、封存告警與provider outage演練待驗。 E06/E13/E15 |
| T47 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；沿用provider-specific/mock、canonical交易/退款/冪等/ambiguous狀態機；各支付商資格、sandbox、簽章/查單/收款變更step-up不能用mock替代。 E04/E09 |
| T48 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；沿用provider-specific/mock、canonical交易/退款/冪等/ambiguous狀態機；各支付商資格、sandbox、簽章/查單/收款變更step-up不能用mock替代。 E04/E09 |
| T49 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；沿用provider-specific/mock、canonical交易/退款/冪等/ambiguous狀態機；各支付商資格、sandbox、簽章/查單/收款變更step-up不能用mock替代。 E04/E09 |
| T50 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；沿用provider-specific/mock、canonical交易/退款/冪等/ambiguous狀態機；各支付商資格、sandbox、簽章/查單/收款變更step-up不能用mock替代。 E04/E09 |
| T51 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；沿用provider-specific/mock、canonical交易/退款/冪等/ambiguous狀態機；各支付商資格、sandbox、簽章/查單/收款變更step-up不能用mock替代。 E04/E09 |
| T52 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；本機durable outbox/重試/lease失敗測試通過；供應商接收後process crash與真實DLQ重放仍需sandbox證據。 E09/E10 |
| T53 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；庫存/優惠/贈品canonical SQL回歸通過；完整多端最後一件競爭與真實跨程序壓測尚未重跑。 E17 |
| T54 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；真實本機QR→現金確認仍不完成→人工交付E2E通過；列印/付款/交付獨立語義的SQL與unit通過。硬體效果另列。 E14 |
| T55 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；B2C計量/排除mirror與B2B、每攤月界/封頂/含稅/版本及退款契約本機回歸通過；商業及會計簽核另列。 E02/E09 |
| T56 | REQUIRED | REUSED_VERIFIED | PASS | 工程/資安；B2C計量/排除mirror與B2B、每攤月界/封頂/含稅/版本及退款契約本機回歸通過；商業及會計簽核另列。 E02/E09 |
| T57 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；hash/scope/lease/ACK/列印queue本機通過；實機憑證rotation、掉線、開櫃權限與回讀待驗。 E14 |
| T58 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；hash/scope/lease/ACK/列印queue本機通過；實機憑證rotation、掉線、開櫃權限與回讀待驗。 E14 |
| T59 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；hash/scope/lease/ACK/列印queue本機通過；實機憑證rotation、掉線、開櫃權限與回讀待驗。 E14 |
| T60 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；既有PWA/offline scope/permit/重送本機回歸通過；真機多分頁/OS儲存/換店/待同步保全需實測。無本次新增native App。 E14/E18 |
| T61 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；既有PWA/offline scope/permit/重送本機回歸通過；真機多分頁/OS儲存/換店/待同步保全需實測。無本次新增native App。 E14/E18 |
| T62 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；既有PWA/offline scope/permit/重送本機回歸通過；真機多分頁/OS儲存/換店/待同步保全需實測。無本次新增native App。 E14/E18 |
| T63 | REQUIRED | PARTIAL | BLOCKED | 工程/資安；合成DB還原與應用側撤權通過，檔案bytes/Auth設定/新撤銷feed未驗；不稱完整恢復。 E11 |
| T64 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機origin fence/replica apply及project身份、rollback拒絕契約通過；全新tree真實DR schema/publication/single-worker/failback/Plan未執行。 E12 |
| T65 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機origin fence/replica apply及project身份、rollback拒絕契約通過；全新tree真實DR schema/publication/single-worker/failback/Plan未執行。 E12 |
| T66 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機origin fence/replica apply及project身份、rollback拒絕契約通過；全新tree真實DR schema/publication/single-worker/failback/Plan未執行。 E12 |
| T67 | REQUIRED | REUSED_VERIFIED | BLOCKED | 工程/資安；本機origin fence/replica apply及project身份、rollback拒絕契約通過；全新tree真實DR schema/publication/single-worker/failback/Plan未執行。 E12 |
| T68 | CONDITIONAL | IMPLEMENTED | PASS | 工程/資安；conditional72h、未知待評、知悉時間不可延後、人工receipt及狀態機本機通過；依法適用/真實通知尚需簽核。 E01/E15 |
| T69 | CONDITIONAL | PARTIAL | BLOCKED | 工程/資安；complaint15日與人工結果證據流程已實作；食品/零售適用、完整帳戶刪除與資料移轉非僅文案能完成。 E01/E02/E07 |
| T70 | CONDITIONAL | REUSED_VERIFIED | BLOCKED | 工程/資安；既有商品翻譯provider本機契約通過；hosted跨租戶AI輸入/供應商保留與惡意資料測試待核，沒有新增任意工具agent。 E16/E18 |

## 2026-09-30 v2.0 同步（本機，未發布）

2026-10-02 整合契約：新平台通知採單一攤點通 PLATFORM_OA，既有 LEGACY owner 保留隔離；各店 LINE Pay 獨立收款。通知、MINI 與 Pay 分別控制，並驗證整體與子旗標依賴／在途訂單。09-30 各店 OA 現況假設已被本輪使用者指令取代；歷史證據不重標 PASS。詳見 [整合安全契約](INTEGRATION_CONTRACT_20261002.md)。

| 控制 | 必要情境 | 本輪結果 |
|---|---|---|
| T71 | 平台 webhook 必須核對簽章、destination、environment 與 active binding；事件不得跨租戶更新訂單或觸發通知，錯簽章及停用被拒。 | NOT_RUN；整合與外部驗收未完成 |
| T72 | 商家或支援帳號不可讀取、借用平台 OA token／secret，也不可套用另一店 Pay merchant；輪替後舊版本停止生效。 | NOT_RUN；整合與外部驗收未完成 |
| T73 | 平台管理者讀取遠端 Webhook、測試、套用、狀態核對與遠端失敗各有正確權限、差異、稽核及可回復狀態；惡意 URL 不可 SSRF。 | NOT_RUN；整合與外部驗收未完成 |
| T74 | OA 通知、Mini Store、LINE Pay 三開關的八種組合及撤銷均不破壞其他能力或既有訂單。 | NOT_RUN；整合與外部驗收未完成 |
| T75 | 通知 worker 的延遲、重送、額度不足、封鎖、退訂、換綁與停用 sender 不跨店、不雙發，且不重做訂單／計費。 | NOT_RUN；整合與外部驗收未完成 |
| T76 | 不同 OA／Login channel 的相同表面 user ID、email、電話不自動合併；切換 sender 前確認收件資格，歷史事件仍可追溯。 | NOT_RUN；整合與外部驗收未完成 |
| T77 | 平台 OA rollout 與回退只能在明確授權、環境 binding 和功能旗標下執行；未具資格停止新平台發送，不以任意商家 OA 代發，過渡不雙發、不洩漏。 | NOT_RUN；整合與外部驗收未完成 |
| T78 | A 店的 LINE Pay return、Confirm、退款及對帳不能變更 B 店付款；未知狀態及重送不重複扣款。 | NOT_RUN；整合與外部驗收未完成 |
| T79 | 顧客轉發取餐卡／QR、跨店掃描、重掃或並行核銷都不能越權；付款、核銷、列印、配送各自獨立。 | NOT_RUN；整合與外部驗收未完成 |
| T80 | 第三方 POS／供應商／承運者只能操作明確授權交易；離線任務重派後，舊裝置補傳及 ePOD 附件須拒絕。 | NOT_RUN；整合與外部驗收未完成 |

T01–T70 保留原日期與範圍；不因文件同步重標 PASS。T71–T80 尚未固定整合版、逐入口實測，不能用既有檔案名稱推定完成。責任：工程／資安；LINE、支付與契約 owner 見 E19–E22。
