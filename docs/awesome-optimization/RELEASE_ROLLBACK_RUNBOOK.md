# Awesome 本機候選版本：發布與回復手冊

狀態：**IN_PROGRESS／尚未取得整體驗收證據**。本文件是發布準備，不是執行收據或正式啟用授權。2026-10-01 目前只完成 B1 有界工具審查，B2 實作與審查尚在進行；其餘依 `EXECUTION_STATE.json` 與各批原始證據更新。不得把文件存在、build 成功、部署 READY 或旧版測試數量視為本輪完成。

## 候選範圍與身分

本機候選位於 `C:/Users/KY/.codex/worktrees/responsive-cross-device/Stallorder-Platform`，分支 `codex/responsive-cross-device-20260930`；本輪起點 HEAD `87230e266281472a71fd764d616be1adf788c635`、tree `ee9337ebc9a311ce68e1d2c1500379ab67129714`。Awesome 增量保持 unstaged／uncommitted，依每批實際 BEFORE／AFTER bytes、SHA256、合併後 effective-input digest、configuration digest、buildID 與 fixture 身分辨識，不能僅依 HEAD 判斷候選內容。

唯一共用測試環境為 Docker/Supabase project `stallorder-responsive-20260930`，API56821、DB56822，以及同一來源 App `http://127.0.0.1:3026`。建置、Web 瀏覽器、Native emulator、效能量測串行使用；僅必要條件有具體理由時才增開環境。`awesome-b1` 固定資料集保持不可變，任何會寫入商品、訂單、申請、權限或訂閱的驗證使用當批獨立合成 scope，不回寫固定量測資料。

正式站已讀回的 Primary 基準為 project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`、deployment `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`、commit `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`、`https://app.qidaigo.com`。此為歷史唯讀基準，發布前必須重新核對 account/team/project/deployment/alias/backend/commit/健康及相容回復產物；未執行 authenticated affected-flow，不可描述為正式完整流程通過。DR 與其他工作區不在本輪寫入範圍。

## 尚未開放的動作

本輪沒有 Git add/commit/push/merge/deploy、正式 migration、環境變數／domain／Access／DR 調整、建立付費資源或新帳號／credential、真實 LINE／Push／Email／Pay／analytics 送出、EAS／商店／OTA 發布授權。外部檢查僅讀取名稱、PRESENT／MISSING、目標與 disable 狀態，不顯示 secret 值，不以假值填補 gate。

GitHub Preview 的 required-reviewer rule 在本輪唯讀查核中為 MISSING；manual dispatch、opt-in、environment 名稱不能代替實際非空 reviewer 規則與成功讀回。現有 fail-closed workflow gate 必須保留。`EXTERNAL_SETUP_CHECKLIST.md` 集中列真正選用功能的必要設定；未選用 SurveyJS／Novu／Trigger.dev／PostHog／Formbricks／Meilisearch／Metabase／SigNoz 等不要求新帳號。

## 未來受控啟用順序

1. **同一候選驗收。** 完成批次實作與獨立審查、合併後 unit/type/lint/build/DB-RLS/Web/可執行 Native、安全／license／secret、實際業務鏈與 failure injection。required failed/not_run/timeout 不得改為 pass。固定資料與版本相同的原始前後量測須包含 request/refetch/list/DB query 計數；未量測項保留缺口。
2. **精確只讀 preflight。** 綁定將發布的實際 commit/tree/effective inputs、設定、相容 migration、目標 account/team/project/DB/alias、目前正式基準及已驗證回復產物。確認單一遠端 writer 與合法 Staging 測試帳號；不把 Staging 資料搬進 Production。
3. **相容 backend/schema。** 先在受權 Staging 依既有 migration 流程套用 additive schema/backend，驗證舊 Web/App 契約、RLS/grants、冪等鍵、權限與 canonical ledgers。每一步讀回目標及 Primary；不直接在 Production 試修資料。
4. **無外部依賴 UI/query/form。** 套用已驗證讀取、快取、表格、草稿版本與介面；用同一候選驗證舊 session、切換帳號、晚到 response、登入與回復、完整編輯／申請／點餐／結帳鏈。不得新增平行 SSE/polling owner 或代收代付核心。
5. **受控測試通路。** 明確列合法 test actors、隔離商家、allowlisted endpoints、期間與單次驗收。MINI、OA、Pay 資格與同 Provider eligibility 分別讀回；缺失保持 NONE/paused，不推測先前 PR365 期限資源仍有效。
6. **選定通知／jobs／analytics。** 新功能預設 disabled，逐一指定旗標、當前 intent/binding version、sender、收件資格、provider、queue/scheduler owner、風險／budget／回復。既有正常正式功能不因本輪自動關閉；不改寫舊 intent 收件身分。真實生效必須另取得精確 target/action 授權及 provider 證據。
7. **Mobile preview。** 共用已驗證 Auth/BFF、SecureStore 與 DTO，核對實際 binary/source/lock/SDK/flags；Android emulator、iOS、實機、signing/store 各自呈現，不用 Web viewport 或臨時 NativeWind pilot binary 替代最終產物。
8. **人工 rollout。** 依受權 merchant canary 逐步擴大，每個可能影響正式服務的 remote step 後讀回 Primary 與受影響流程；異常停止後續 release writes並先恢復。舊的部署或緊急授權不能代替本輪精確許可。

以上是規格，不表示任何一步已執行。正式站新功能、安全風險、硬體列印／錢櫃及 LINE／Pay 真實驗收仍按各項 required gate 判斷。

## 按既有 owner 回復，不逆轉業務事實

| 範圍 | 安全回復與保留 | 必須重新核對 |
| --- | --- | --- |
| UI/query/Table | 以當批 exact BEFORE bytes 與後續 owner handoff 還原自己的增量；先比對目前 hash，避免覆蓋別人修改。關閉新 read adapter／旗標可退回原 owner，完整 editor 不接受 paged snapshot。 | current auth/scope、舊 view/cache disposal、三個列表及完整編輯；不能回復 POS pending outbox。 |
| 草稿／申請 | 停止新 autosave 並保留 server draft、dirty values、expectedVersion/conflict；舊 adapter 相容 additive schema。不降回 draftVersion 或撤銷已合法核准／開店事實。 | 補件、同一 case resubmit、原子核准與 Owner 明確開店；版本衝突可恢復。 |
| Inbox／intent | 停止本次新發送通路，不刪除原有 durable intent/receipt/read state。新 schema 以相容舊 consumer 方式留存，保留 sender/recipient/binding snapshot。 | personal audience/RLS、未讀計數、跨角色／租戶、既有業務結果與通知分離。 |
| report jobs | 保持唯一 scheduler/queue owner；先停止新 claim，再依 lease/token/version fence 讀回 in-flight、accepted、UNKNOWN、dead-letter。UNKNOWN 需要證明或授權人工 reconciliation，不能因 rollback 直接重送。 | 兩 executor、過期 lease、最後一次 crash、provider response loss、不可變 snapshot、人工權限。 |
| Search／dashboard | PostgreSQL canonical truth 保留；撤回選用 read adapter/index/view，不刪商品或重建另一 ledger。若未採外部 index，不要求虚构 reindex/provider。 | stale price/sold-out、scoped hits/count、test排除、退款/PAYG per-stall cap及 period/late adjustment。 |
| Telemetry／feedback | 撤回非必要同意即停止 mount/import/send；Noop/Test 失敗不影響核心業務，保留合法 feedback receipt並依留存處理。不可重新送撤回前 queue。 | 未知欄位／PII／full URL 被拒、logout/withdrawal generation、receipt/admin權限、sender未啟用。 |
| Native | 回復相容 App/BFF adapter，不改既有 Web CSRF/CORS。先證實 family/session/clientKind、SecureStore serialized generation、old wire DTO相容；關閉新 flags但不偽造 remote logout/生物辨識授權。 | actor切換／token refresh/logout／重啟／前背景與NetInfo lifecycle、正確 itemID、offline cache不是權限。 |
| Dependencies | 在 source-bound服務停止後依 exact preimages／current消費者 handoff 回復受影響 package/lock；不能用全庫 downgrade/audit fix。安全版本退回可能再次引入 advisory，必須明列阻擋。 | caller實際API、完整merged lock audit、unit/type/lint/build與受影響流程；跨Next版本不能拼性能pair。 |

資料回復只限具有 exact ownership、當前 CAS postimage 相符且未被其他驗證使用的合成 fixture。不得逆轉 monotonic revision、合法付款／退款／交付、既有庫存預留或 financial ledger。無法安全刪除的測試資料保留並回報，不為恢復「乾淨」而猜測 preimage。

## 收尾與證據

執行收据須包含命令、時間、cwd、exit、raw log、effective source/configuration/build/fixture與相關 test結果；Production/read-only/provider/device各自標記。單一 pass不能掩蓋 required缺口。最後由 `EXECUTION_STATE.json`、`FINAL_VERIFICATION_REPORT.md` 與中央外部清單交叉讀回。

測試完成後停止本次已無依賴的 exact服務與容器，保留 container/image/volume/data；不用 prune/reset/machine-wide stop。若使用者明確要求保留 manual QA，列保留的同一 project/ports與 owner；其餘私有 worker/proxy/emulator fixture關閉。開始下次測試時先核對 labels、consumer、來源與 ports，再按需恢復。


## B6a additive feedback 候選交接（2026-10-02，NOT_RELEASED）

Migration 20261002090000_product_feedback.sql 只新增 private feedback table/index/policy；不得以舊 schema gate 當新 schema 授權。新 product-feedback-v1 overlay 綁 exact Prisma schema，live-fixture-guard 只切到新 named overlay；保留原 freeze SHA、f04f、201 draftVersion0 及兩舊 approvals。舊 overlay/helper/receipt 保留歷史，不回寫基準。後續 schema writer 需新 version/hash/source approval，再構造 DB client。

未部署或執行 remote migration。回復應用時可保留 additive table；停止本批讀寫/maintenance hook，不刪現存回饋或改舊 ledger。Vercel collector 保持 disabled，不能用舊自動 mount 版本作為 privacy regression 的回復目標。B6a fresh controller 僅 exact responsive 六容器 API56821/DB56822，Edge R106 已停止；public CircuitB 後續需要時由 root exact start 並重新封存 allowlist。B5 old APK/current Web artifact 不代表 B6a build；所有新執行要 fresh source/build/schema/baseline pins。
