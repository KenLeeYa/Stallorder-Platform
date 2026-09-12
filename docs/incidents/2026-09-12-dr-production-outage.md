# 2026-09-12 正式站異常：DR 發布誤用 Primary 專案

紀錄日期：2026-09-12；本文時間均為 Asia/Taipei。事件已恢復網站可用性，DR 發布仍暫停；後續 DR 遠端驗證尚未完成。

## 使用現況與影響

- 使用者確認：系統尚未正式推廣，目前僅三間商家協助測試功能；本次異常發生於非使用系統時段。
- 已確認的技術影響：`app.qidaigo.com` 首頁、登入與健康檢查回傳空白 HTTP 403，正式系統入口無法使用。形象官網 `qidaigo.com` 仍 HTTP 200。
- 非使用時段是本次的影響背景，不是可接受再次停機的理由；試用商家仍須能正常登入及使用點餐功能。
- 本次恢復作業沒有異動顧客訂單、DNS、密鑰或資料庫寫入角色；未執行完整交易與資料差異盤點，不把網站恢復視為已完成所有營運流程驗證。

## 根因與失效的控制

DR workflow 原本要部署獨立的 `stallorder-dr`，但子程序繼承了正式專案的 `VERCEL_PROJECT_ID`。腳本只改 `.vercel/project.json`；當次使用的 Vercel CLI 56.3.1 優先採用環境變數，因此 DR deploy / promote 實際操作了正式的 `stallorder-platform`。

正式網址因而指向帶有 `backend_target=DR` 的部署。該部署啟用 DR 網址存取限制，只允許 `dr.qidaigo.com` 等核准入口，正式網址被拒絕並回傳 HTTP 403。背景工作亦出現 `BACKEND_NOT_WRITABLE`，符合誤接唯讀 DR 後端的情況。

DR 目標專案沒有預期部署，後續入口驗證以 `DR_ENTRY_VERCEL_ORIGIN_TLS_TIMEOUT` 失敗。只延長 TLS 等待時間無法解決專案誤綁。原回復流程僅清除新建 DR 資源並恢復 staging 綁定，未恢復或檢查 Primary deployment、alias 與 health，於是產生 `completed=false`、`rollbackCompleted=true`，正式站卻仍故障的結果。

## 時間線與恢復證據

| 台灣時間 | 事件與證據 |
| --- | --- |
| 9/11 15:55–15:58 | 最近一次正常 [Production Application Release 34576607863](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/34576607863) 成功，後續以此版本作為恢復候選。 |
| 9/12 05:17–05:26 | [DR Apply 34648606836](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/34648606836) 失敗；DR 部署建立於 05:18:26，正式 alias 約 05:20 被更新。此為變更時間，並非連續監測取得的精確停機起點。 |
| 07:19–07:27 | 公開網址與 Vercel API 交叉確認正式站 HTTP 403，實際指向錯誤 DR 部署。 |
| 07:29 | [Plan 34658229816](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/34658229816) 成功，但 Apply skipped；DR 尚未發布完成。 |
| 09:30 | DR 專案隔離修補的 main CI、Readiness 與安全檢查通過；正式站仍 403，未重新執行 DR Apply。 |
| 10:01 | 依使用者「10:00 前未完成則暫停 DR、先恢復正式環境」授權執行；先再次核對候選版本 READY、project 正確、入口與 health 正常。 |
| 10:01:52 | 對指定正式 project/deployment 執行一次 rollback，provider 回傳 HTTP 201。 |
| 10:02:32 | 正式 alias 與 production target 均已指向正常版本；首頁、登入、店員登入及 `/api/health` 全 200，health 為 `HEALTHY`。 |
| 10:04–10:05 | 20 項實際 smoke 檢查通過；`/merchant/stalls` 未登入時 307 導向 `/login`，符合預期。專屬 QR 檢查 skipped，沒有執行 QR／外帶完整下單。 |

| 用途 | 不可變識別 |
| --- | --- |
| 正式 project | `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`（`stallorder-platform`） |
| 錯誤部署 | `dpl_Cxf1M41t8TksXXFtetYQKrc5km22`；commit `82f6869d38db7c6fc35e26f83d49353380218241`；`backend_target=DR` |
| 恢復部署 | `dpl_43NbkcsahvpA4n5BqUsiPrFA6wtP`；commit `202a3c2debfe8a668177521ea10100c7711b293a` |

恢復期間只有本任務執行正式站遠端寫入；「功能修正與增加」任務保持 DR Apply／alias 寫入暫停。截止檢查自動化 `dr-10` 已設為 PAUSED。其他工作區的服務及工作檔未作為恢復目標。

## 後續更新必須遵守

適用於應用功能、登入權限、環境變數、部署、網域、Cloudflare Access、資料庫及 DR；先盤點相依路徑，不能只驗證被修改的單一功能。

| 階段 | 必須完成的檢查 | 發現異常時 |
| --- | --- | --- |
| 更新前 | 確認實際服務 worktree、commit/tree、provider project、正式 alias、部署、backend target；記錄登入入口、health 與受影響流程基準。驗證可相容的正常恢復版本。 | 正式站已異常時先處理事故，不以故障狀態建立「正常基準」。 |
| 非正式環境驗證 | 在隔離測試環境驗證正常、失敗與相依流程；登入或點餐共用元件異動，須覆蓋商家／店員及適用的 QR、自取、外送路徑。 | Gate 失敗先修正；測試環境成功不能直接宣稱正式站正常。 |
| 遠端異動中 | 跨任務協調單一寫入者。明確綁定子程序 project/org，逐步讀回實際目標；每個可能影響正式站的步驟後檢查正式入口與 health，長時間執行／等待期間定期唯讀檢查。純 DR 作業須保持 Primary 部署、alias、backend 不變。 | 目標不符、正式站 403／5xx、登入回歸或非預期 backend 切換，立即停止後續發布，優先恢復正常服務。 |
| 完成或回復後 | 讀回 provider 與實際正式網址；驗證登入、health、相關訂單路徑及連動功能。必要的交易測試使用已授權測試帳號／攤位。依既有事故規範安排觀察窗。 | 清理成功或部署 READY 不代表可用；回復未驗證成功就不能結案或自動續跑 DR。 |

- 恢復須指定已重新驗證的正常版本，不能盲選上一筆部署：本次歷史中已有多筆誤落在 Primary 的 DR 部署。
- 正式應用回復與資料庫 failback 分開處理。若 DR 已成為 writer，依既有 failback runbook 對帳，不直接切換 backend 或解除 fence。
- 報告清楚分開「通過／失敗／略過」。HTTP 200 登入頁不等於已完成登入；無效 QR 安全檢查不等於有效 QR 可下單。本次 smoke 的專屬 QR 因缺少測試入口而略過，不能把腳本含 skipped 的 21/21 視為 21 項均實測。
- 保留變更前後狀態、時間、部署 ID、測試結果與回復收據，不保存密鑰或顧客個資。非使用時段與試用階段同樣遵守以上檢查。
- 本節是日後工作的執行要求；本次文件更新沒有新建全天候監控服務，也未重新發布 DR。

## 改善進度與待驗證事項

| 項目 | 截至本紀錄的狀態與完成條件 |
| --- | --- |
| 正式入口恢復 | 已完成，10:02 provider 與正式網址回讀一致。 |
| 專案隔離與 Primary 保護修補 | DR 維護任務透過 PR #342／#343 合併 staging／main；main `b2ee581bcaaa7102cc077fb4433a261f0fea7963`，共同 tree `52c23d1da107e3279ef667caf8b0f631ca39b4e0`。已加入明確子程序綁定、實際 project 驗證、Primary 基準與回復檢查；09:30 已獨立讀回 main CI／Readiness／安全檢查成功。這不代表 DR 遠端發布已通過。 |
| DR 再次發布 | 暫停。後續發布責任人須依當時授權、正常 Primary 基準與最新不可變 Plan 執行，完成獨立 DR 驗證且證明 Primary 未被改動；恢復正式站不自動解除暫停。 |
| 正式端完整交易回歸 | 尚未於本次事故實測。下次相關發布須由發布責任人使用專屬測試入口／帳號補齊有效 QR、自取及受影響店員流程；不得操作真實顧客訂單代替 QA。 |
| 規則保存 | 本次已寫入專案 `AGENTS.md`、事故入口、GPT 6 交接及使用者明確要求的持續記憶備註。後續 release worktree 須攜帶並遵守。 |

## 證據與相關規範

原始證據保留於本機 [事故證據目錄](<C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/production-outage-dr-20260912>)：`INCIDENT.md`、`DEADLINE_RECOVERY.md`、`restore-candidate-preflight.json`、`restore-request.json`、`restore-live-readback.json`、`production-smoke-after-restore.log`。這些為上述時間點的證據，後續作業仍須重新確認即時狀態。

相關規範：[事故應變](../INCIDENT_RESPONSE.md)、[正式回復](../PRODUCTION_ROLLBACK.md)、[DR failback](../PRODUCTION_FAILBACK_RUNBOOK.md)、[正式 smoke](../PRODUCTION_SMOKE_TEST.md)。
