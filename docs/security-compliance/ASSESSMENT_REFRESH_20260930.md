# 2026-09-30 評估差異與隔離本機更新

## 結論與範圍

已完整閱讀下載的 `Stallorder_Security_Compliance_Assessment_20260913.md`，共 203 行，文件內標示架構更新至 2026-09-29。與 2026-09-13 的 175 行舊版相比，確有實質增加；原 T01–T70 清單不能代表新增 LINE OA、OMO／SCM 和第三方入口的完整驗收。

本輪只更新獨立資安 clone 的本機 QA 啟動隔離及評估／驗收文件。沒有移植仍在改版中的 LINE／UI 程式，沒有修改 DB schema、套用 migration、啟動 Docker、推送、發布或改變正式／DR 設定。新隱私功能維持 OFF，刪除 dry-run，完整發布仍為 NO-GO。

## 可重現的輸入比對

- 新版原始檔逐位元保存於 [assessment-20260929.md](inputs/assessment-20260929.md)，SHA256 `8a3228232092909a3ed3f3d2c04404c2674d34b064b7e5d411feb203101d04bd`。
- 舊檔已不在 Downloads；從本任務 2026-09-13 05:08:46 UTC 的完整 `Get-Content -Raw` 輸出取回，[assessment-20260913.recovered.md](inputs/assessment-20260913.recovered.md)。該輸出未截斷，恢復文字 SHA256 `05fcbf7bfa8136c397e1a05300ddc4d194588583c957d2af14d44d1f70b6caa3`。這是歷史文字的 UTF-8 重建，不冒稱取得舊檔原始位元／BOM。
- [完整文字差異](inputs/assessment-20260913-to-20260929.diff) 使用 `git diff --no-index --ignore-space-at-eol`，排除行尾空白差异；29 個非空新增行、7 個非空移除行。新增一行可能是一整個表格驗收項，不以行數估算完成比例。
- 已完整閱讀新版 Prompt v2.0（707 行），原始 SHA256 `758e3991fdd035549030f4f6cce0204850e2cf9d21673df5ea9157552d4bdab1`；原樣保存於 `inputs/prompt-20260930.received.md`。舊版從同一任務完整 stdout 恢復；差異為 56 新增行／3 移除行（含空行），新增架構優先規則、T71–T80，並將舊法規查核日期改標歷史。Phase 00–15 主體保留，未冒稱全部重跑。

## 新 Prompt 的優先規則

目前目標是各商家自有 OA 發訊；OA 通知、Mini Store、LINE Pay 三開關獨立。平台 OA 僅為未來明確選用的受控遷移，不是現況或預設。此規則優先於 09-29 Assessment 的平台單一 OA 假設。 新增 T71–T80 統一記入 CONTROL_REGISTER 與 SECURITY_TEST_MATRIX，全部 NOT_RUN。以下 A29 表格僅保留 Assessment 差異，平台相關字句不得解讀成目前 sender 模式。

## 實質增量

| 位置 | 舊版 → 新版 | 本輪處置 |
|---|---|---|
| §1、§1.1 | 增列 OMO／SCM v2、平台 LINE OA v2、接力流程與跨系統入口；要求区分規格、歷史與現況證據 | 固定資安與改版來源，各項新增功能不沿用舊 PASS |
| §1.1 計費 | NT$1／NT$1,499 明確是歷史契約，實際須核現行 PlanVersion | 不改價、不啟用收費；留待商業／會計核對 |
| §3.1 P0 | 平台顧客／多店訂單、OA webhook／通知、取餐 QR、各店 LINE Pay、平台配額共 5 個切片 | 建立下方 A29-01～05，指向另一分支已有程式，未移植、未認定通過 |
| §3.1 P1 | 供應鏈品質、TMS/ePOD、配送離線、第三方 POS 共 4 個切片 | 建立 A29-06～09，確認資料與外部契約前不臆造實作 |
| §3.1 證據 | 要求固定 HEAD、migration／route、環境、正負案例及外部證據 | 本輪 receipt 僅涵蓋本機環境檔隔離；mock 不算真實 LINE／Pay 成功 |
| §4.1 | 文件聲稱 09-29 再核新法生效狀態；刪除舊「整編截止 09-04」說明 | 本次未重新作法律查核；保留外部核定，不據此改通報或保存程式 |
| §7 | 舊 Prompt 明確屬先前範圍，新增三份架構參照 | 保存新版快照，原驗收紀錄保持歷史適用範圍 |

原多租戶、伺服器交易權威、個資生命週期、帳務保留與 DR 單一 writer 原則並未取消。平台共用 OA 也不表示可跨店共用 Pay 收款憑證或將顧客資金交平台保管。

## 並行工作區與影響判斷

| 對象 | 查核結果／本輪邊界 |
|---|---|
| 本輪來源 | `Stallorder-Platform-security-compliance-20260913`；起點 `c31a5d9b379086b04360430aa71564b083a99292`，獨立 `.git`，無 objects alternates，node_modules 非 junction，無 `.codegraph` |
| 本輪分支 | `codex/security-assessment-refresh-20260930`；保留原 `codex/security-privacy-compliance-20260913` 指向舊候選 |
| 改版任務 | 「新版對話功能修正」，實際 checkout `C:/Users/KY/.codex/worktrees/responsive-cross-device/Stallorder-Platform`，其 common Git 在原專案，與本輪不同 |
| 改版版本 | 任務 ledger 的基線 `fb3974155a4cec2288168711acdc6306d8350fd2`；觀察到 HEAD 從 `1ac0e65`、`a986b2b` 繼續到 `507dc10`，屬活動中的工作樹，不稱 worktree stable |
| 檔案交集 | 在 `fb39741..507dc10` 的 71 個改版檔與舊資安 111 個變更檔之間，交集為 `docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md`；本輪不改此檔 |
| 較新基線交集 | 從資安原起點 `4ab57b6` 比較較新基線，另涉及 `.agents/skills/stallorder-product-qa/SKILL.md`、`.env.example`、CI、Prisma schema、`start-local-qa.mjs`、訂單追蹤頁與架構紀錄。將來須逐差異整合，不能整檔覆蓋 |
| Docker／服務 | 改版的 `stallorder-responsive-20260930` 使用 56821／56822，catalog lab 使用 55722；本轮沒有啟停或寫入任何容器。資安舊 lab 的 55991／55992、55982、3093 未使用 |
| 影響判定 | 本輪分支與檔案更新不會改寫另一個 checkout；測試只建立短暫的合成環境檔及 Node 子程序，單 worker 執行。日後合併與 5 個舊候選 migration 仍會影響共同程式／DR，並非可直接發布 |

正式唯讀基線：Vercel project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`，deployment `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`，commit `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`，READY。登入與員工登入 200，公開 availability 回報 PRIMARY／epoch 3。匿名 `/api/health` 回 401，沒有當成健康通過或故障證明；已登入與有效 QR 交易流程 NOT_RUN。本輪無遠端寫入，未使用任何回復 artifact。

## 新版增量控制與後續整合

以下來源僅以改版固定基線 `fb3974155a4cec2288168711acdc6306d8350fd2` 的 Git tree 核對檔案存在；只有 `line-platform/runtime.ts` 另作內容檢視。檔案／測試名稱存在不代表行為通過，更不代表已在本資安 clone 或正式環境可用。下列全部保留 `NOT_RUN`，條件／外部依賴另列 BLOCKED。

| ID | 要求與公開介面驗收 | 可沿用的來源線索／缺口 |
|---|---|---|
| A29-01 P0 | MINI App 登入到本人多店訂單；拒絕同 email 自動併帳、跨人訂單與換綁後舊任務 | `src/server/line-miniapp/identity.ts`、`identity.test.ts`；需固定整合版後走 provider／callback／本人頁及撤權 |
| A29-02 P0 | OA raw-body 驗簽、destination、事件去重；封鎖／解除綁定後不再發送且訂單仍可查 | `src/server/line-platform/notification-webhook.ts`、`notification.integration.test.ts`；需測真實 webhook、重放及接收資格 |
| A29-03 P0 | 掃描 GET 無副作用；POST 綁店、付款／履約版本與一次核銷；拒絕重掃／跨店 | `src/server/line-platform/pickup-service.ts`、`pickup.integration.test.ts`；須涵蓋合法完成及競爭案例 |
| A29-04 P0 | Pay attempt 綁商家、環境、憑證版本、金額／幣別；未知結果先對帳，退款不超額 | `src/server/payment-providers/line-pay-v4.ts`、`line-pay-v4.test.ts`；真實 merchant sandbox 及並行退款待驗 |
| A29-05 P0 | 租戶不能指定任意收件者／sender；平台總額與各店配額；補發不重做付款／取餐／計費 | `src/server/line-platform/notification-binding.ts`、`notification-worker.ts`、`runtime.ts`；需負案及斷線／延遲 worker 測試 |
| A29-06 P1 | 跨供應商／門市及撤權拒絕；FEFO、隔離／到期批次不得出庫；收貨不解除隔離 | 新版要求，現有 Supply Lite 不直接當完整 WMS／品質模組；待確定實作來源與資料契約 |
| A29-07 P1 | 任務指派與 custody 授權；駕駛最小欄位；GPS／簽收／驗收／付款分離；私有 ePOD | 未在本輪確認完整模組或真實承運介接，須先盤點 |
| A29-08 P1 | 舊指派裝置、附件補傳及重放拒絕；共用 iPad 換店清除個資並保留未同步交易 | 舊 PWA／POS 回歸不足以證明配送離線；裝置、任務版本與實機另驗 |
| A29-09 P1 | 合作夥伴獨立 scope／憑證／撤銷／配額，外部訂單 ID 帶來源，事件權威明確 | 條件式業務，缺核准契約與實際接入清冊；不建立推測的 adapter |

本次環境檔修正是上述介接在本機 QA 的共同前置保護，不將 A29-01～09 任何一列改標 PASS。

## 本機修正與驗收

已重現：父程序使用 allowlist 移除 provider token 後，Next 的環境載入器仍會讀 `.env.development.local` 等檔案，把 token 加回子程序。這是本機測試隔離缺口，不是聲稱正式環境已洩漏。

`buildLocalQaEnvironment` 新增明確的 envDirectory 查核，兩個使用它的 QA 啟動器均傳入實際工作目錄。逐一檢查 Next development 的四個環境檔，拒絕任何未預先填入受驗證子程序環境的鍵；即使被上層值遮蔽，外部 URL／host 仍拒絕。錯誤只列檔名／鍵名，不輸出憑證與 URL。Next 真實 loader 的合法控制案例確認 mock 模式與 loopback 保留。

初始負案 5 失敗、2 控制案例通過；修正後聚焦回歸及最終 QA 結果見 [本輪收據](ASSESSMENT_REFRESH_20260930.json)。沒有執行完整 LINE、付款、瀏覽器交易、DB／RLS 或 DR 演練，因此不將本輪測試稱為全系統驗收。其他未使用此 helper 的歷史 launcher、OS egress 與 DNS pinning 仍須分別整合。

## 最後集中處理的外部／法律／會計項目

沿用 [E01–E18](EXTERNAL_SETUP_CHECKLIST.md) 的未完成責任；新增 LINE 平台角色與各店支付契約、OA／MINI App 資格、各店 sandbox、供應商／承運者資料共享及 ePOD 留存、第三方 POS 委託與事件權威。新版對法律生效狀態的敘述是文件來源主張，本輪未作新的法規有效性認定。PlanVersion、實際費率、稅務、退款與財務保留由商業／法務／會計核定，不因本次文件比對改值。新的範圍須重新核定告知、DPA、資料 inventory 與刪除 adapters；仍不能宣稱全帳戶匯出／刪除完成。
