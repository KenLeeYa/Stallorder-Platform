# Awesome 外部設定集中清單

狀態：2026-10-01 工作中草稿。尚未到 Phase18 最終驗收；後续批次必須以實際採用的功能、變數與測試結果更新本表。本機可自動化工作繼續，這份文件不要求現在逐項申請帳號，也不授權外部寫入。

本輪只使用現有 responsive Docker API56821／DB56822 與按需 App3026。一般本機測試、Noop/Test、PostgreSQL 搜尋、內建報表、現有排程不需新的雲端資源。未選用的 Survey Creator、Novu、Trigger.dev、PostHog、Formbricks、Meilisearch、Metabase、SigNoz 不建立帳號、不開免費 trial、不索取密鑰。未選用 Google Forms／Sheets 同步，不申請其 scope。

每項必須在最終版本列出：ID／能力／是否採用／原因／必需或選配／前置依賴、擁有人／最低權限／費用、變數名稱／安全位置／資料目的地、人工步驟／自動驗證／外部副作用、成功證據／回復／fallback／阻擋 gate。秘密只記名稱與安全設定位置，不放值、QR token 或顧客資料。

## EXT-AW-01 — GitHub Preview 審核保護

- 能力／採用：受控手動 ephemeral Preview，工作流程已存在；本輪未執行。需要真實必要審查者，environment 名稱本身不足以保護部署。
- 必需／前置：僅雲端 Preview mutation 必需；本機不阻擋。先完成本機 QA、精確候選來源與 resource owner。
- 擁有人／權限／費用：KenLeeYa/Stallorder-Platform repository 管理者設定 Preview 環境保護；執行 token 僅需讀該 environment 與既有 scoped workflow 最低權限。費用在具體 Preview 方案核對，不擴用歷史 PR365 預算。
- 名稱／位置／目的地：使用 workflow 的 `GITHUB_TOKEN`；其餘既有 Preview secret 名稱在選定方案核對。GitHub environment=Preview；資料送 GitHub／已選測試供應商，不使用 Production secret。
- 人工／自動／副作用：未來經授權設定 required reviewers，再由 fail-closed checker 讀回；本輪只讀。2026-10-01 實際 `protection_rules=[]`，狀態 **MISSING**，缺失、403、網路或格式錯均阻擋建立與 cleanup mutation。
- 證據／回復／fallback／gate：`.superpowers/sdd/2026-10-01-awesome-optimization/preview-approval-readback-20261001.json`；不以失敗讀回觸發刪除。保留本機測試，阻擋遠端 Preview 啟動，不影響現有正式服務。

## EXT-AW-02 — LINE OA／MINI／Pay 個別正式資格

- 能力／採用：沿用現有 LINE 核心。本輪 provider contract 及失敗注入採 mock；最新 Awesome3.2 指定本機停用的商家 OA 能力與管理者明確選擇的平台 OA 替代方案。缺少同 Provider 資格時為 NONE／暫停，既有 intent 不改。先前平台 OA 期待仍需在真實啟用前釐清；本輪不改真實 sender／Webhook。
- 必需／前置：真實訊息、MINI 認證或真實收退款才必需；本機及 mock 不需新帳號。先完成簽章、scope、sender-version、UNKNOWN、支付與取餐 QA。
- 擁有人／權限／費用：既有平台／授權店家 provider 管理者、各店收款商家管理者；Messaging／Login／MINI／Pay 權限分離。實際方案、額度與費用需當次讀回。
- 名稱／位置／目的地：沿用版本化安全 secret references／核准 secret store；實作者在最終表列出實際使用名稱，**不复制歷史秘密**。目的地僅已核准的 LINE 官方服務，各店 Pay 獨立收款。
- 人工／自動／副作用：先唯讀核對現有 Channel、資格及 callback，再提出精確 canary plan；外部設定、發訊、付款及退款需其指定範圍授權。2026-09-28 歷史測試不是本候選的新 QA。
- 證據／回復／fallback／gate：交叉引用 `docs/integrations/line/EXTERNAL_SETUP_CHECKLIST.md`、`SETUP_RUNBOOK.md`、本輪通知設計。舊 PR365 停用／清理資源不自動重啟。保留 immutable intent、sender／credential version 與 UNKNOWN，不盲目補發；既有正式功能不自動關閉。阻擋本輪真實 LINE／Pay／MINI 正式啟用聲明。

## EXT-AW-03 — 既有 Google／LINE／Apple OAuth

- 能力／採用：保留既有身分核心及 provider-subject，不增加帳密註冊、同 Email 自動串帳或新的 OAuth 系統。
- 必需／前置：新的候選環境若需真實 provider 登入才需要對應合法 callback；本機受控 mock 不等於真登入。
- 擁有人／權限／費用：既有身份 provider 管理者／目標環境維運；只需精確測試 client callback 管理，不新增 billing。
- 名稱／位置／目的地：既有 `docs/AUTH_PAYMENT_MANUAL_SETUP.md` 與 `OAUTH_DELIVERY_USER_ACTIONS_REQUIRED.md` 為名稱／安全存放來源；本輪不索取或打印值。
- 人工／自動／副作用：依實际選定測試 hostname 核對 callback／PKCE／state／nonce／audience；配置修改另按精確授權。不要沿用歷史停用 Preview hostname。
- 證據／回復／fallback／gate：須本次 UI 按鈕→provider→callback→受保護頁，錯誤／撤權／刷新／帳號切換。回復精確舊設定；既有 mock 可做穩定回歸，真 provider 尚未測不得稱通過。

## EXT-AW-04 — Native 裝置與發行

- 能力／採用：前移既有 Expo／SecureStore App，真實 FlashList 列表試點；本機 emulator 自動化是內部工作，不需 Apple／Google 新帳號。
- 必需／前置：實體 iOS／Android 證據及未來 store／OTA 發行才需要對應裝置、signing／developer 權限。先完成共用 DTO、audience、revoke、cache／lifecycle、lock/advisory 與實際 emulator QA。
- 擁有人／權限／費用：授權裝置擁有人及既有 App 維運；開發者會員／EAS 計費只有具體發行方案選用才核對。
- 名稱／位置／目的地：Bundle／Package ID、signing、OAuth、Universal/App Links、APNs／FCM 名稱與安全位置由 `docs/mobile/MANUAL_ACTIONS.md`（移植後）交叉引用，不重複要求。僅被選定的服務接收必要資料。
- 人工／自動／副作用：先實機測 keyboard、safe area、orientation、Android back／iOS gesture、SecureStore、帳號／店別切換。store／push／OTA 尚未授權；本輪不得發布。
- 證據／回復／fallback／gate：記錄 OS／裝置／App binary／來源／案例；Web viewport 不能替代 Native。新 flags 預設 false；不可將 mock 當 real push。阻擋真機覆蓋及 App 上架聲明，不阻擋其他獨立本機功能。

## EXT-AW-05 — 實體列印／錢櫃

- 能力／採用：沿用現有 Star webPRNT 與列印工作 owner；不假設所有設備或連線協定通用。
- 必需／前置：硬體出紙／抽屜時序才必需；本機 queue／mock 可先驗證。需要本候選正常結帳、單一列印工作與 UNKNOWN／重試邊界。
- 擁有人／權限／費用：授權測試商家及設備擁有人；原 iPad／Star webPRNT 藍牙為歷史裝置資訊，當次須核對型號／協定／browser／SDK，無新付費 SDK 預設。
- 名稱／位置／目的地：保留商家本機 printer binding；不把 LAN、藍牙或顧客收據內容交第三方分析。
- 人工／自動／副作用：真紙張與抽屜需授權測試操作；record 確認→出紙／開櫃 latency及一次效果；自動化 mock 只證明軟體工作順序。
- 證據／回復／fallback／gate：照片／實測時間與新來源記錄；恢復原精確 binding，保留待列印帳本與人工核對，不能無條件重新出紙。阻擋硬體性能完成聲明。

## EXT-AW-06 — Staging／Production／DR 發布

- 能力／採用：本輪只建立本機 candidate／readonly release package；現有正式、DR 不寫入。
- 必需／前置：未來先 Staging 再 Production；fresh source／Plan、QA、相容 schema／rollback、精確 project／deployment／alias／DB／backend owner必需。
- 擁有人／權限／費用：既有維運與單一遠端 writer；最低 scope 以具體 action 核对，預算不借用歷史 Preview 許可。
- 名稱／位置／目的地：只列既有 deployment secret 名稱及核准平台位置；Primary／DR child-process bindings 顯式，不拷貝測試資料到正式。
- 人工／自動／副作用：read-only dry-run 可執行；migration、flags、deploy、domain、DR、通知啟用需指定 target/action 的 fresh 授權與必要 gates。本機通過不是已部署。
- 證據／回復／fallback／gate：provider readback＋本次正式受影響流程，不能只有READY／HTTP200。驗證相容健康 recovery target；保留 pending offline outbox／job／sender snapshot，不drop schema。阻擋本輪正式發布，不關閉既有正常功能。

其餘候選外部供應商 **未選用／不需申請**。若後续實作證明原生方案不足並選用服務，先補入上述完整欄位及資料處理／留存／最低權限／費用／失敗隔離；不能用假設定讓 external-check 全綠。


## 2026-10-02 B6a 當前選用結果

Feedback 使用既有 Web auth/Prisma/PostgreSQL，不需要外部問卷帳號或秘密。Analytics 固定 Noop，Test 僅測試組合；沒有 collector URL、provider credentials 或新環境變數。Vercel Analytics/SpeedInsights 因已安裝 SDK teardown 未證明而停用，consent ON 亦不載入；未稱供應商收集/撤回驗證成功。PostHog/Formbricks/Google Forms/OTel/BI/search vendors 仍未選用，無建立帳號、trial 或 paid action。
