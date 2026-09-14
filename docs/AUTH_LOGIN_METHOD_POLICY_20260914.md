# 登入方式控制修正與 LINE OA 邊界

日期：2026-09-14；狀態：本機驗證通過的候選，尚未部署 Production。

## 最新需求與根因

使用者更正為關閉「電子郵件與密碼登入方式」，不是停用既有五個管理／營運帳號，也不是要求它們完成 OAuth 身分遷移。既有帳號、Google 登入、Session 與業務資料保留；本機四個固定測試角色仍受原有 loopback／development 限制。

原管理介面把密碼開關反向寫入 `OAUTH_ONLY_LOGIN_UI_ENABLED`，因而觸發全面身分遷移門檻；五個既有 legacy Google 身分沒有新 `auth_identities`，不代表不能使用 Google 登入。此門檻應保留給全面遷移／移除 Local Credential，而不是一般登入方式開關。

## 實作契約

- 新增獨立 `AUTH_PASSWORD_LOGIN_ENABLED`，預設 true；有效密碼狀態仍受完整 OAuth-only 政策否決。
- 商家 `/login`、店員 `/staff/login` 及 `POST /api/auth/login` 使用同一有效狀態；關閉時沒有密碼入口，直接呼叫也回 403。既有帳號不刪除、不停用、不搬移身分。
- Provider 的 runtime/configured 與 legacy Google 判斷集中共用；LINE 未設定完整時不允許假啟用。
- 登入策略修改僅允許不自動到期的 GLOBAL 設定。所有相關 flag 寫入先取得同一 PostgreSQL transaction advisory lock，再讀取最新狀態，避免同時移除兩個備用入口。
- 備用登入必須現在與臨時 override 到期後皆可用；完整 OAuth-only 限制則取較嚴格狀態。伺服器檢查當前管理者 active profile 是否具備相符的已連結身分，或仍啟用的密碼；不因全域顯示某 Provider 就視為管理者已連結。
- 不新增 schema/migration。首次通過授權的密碼策略儲存，才在同一 transaction 建立精確的 flag catalog、override 與 audit；失敗全部回滾。不可透過 DR-first migration 修改複寫設定資料。
- 介面保留確認及取消，使用可見頁內對話框；成功／全域失敗使用既有 `SettingsFeedbackDialog`。五個開關與確認按鈕至少 44px，六語系可用。
- 完整 OAuth migration readiness、CSRF、Origin、RBAC、password verification、session 與 Production 禁止 local-QA 的規則不變。

## 驗證證據

- 初始重現：兩個公開登入頁及 password API 共三個案例先失敗，再修正通過。
- 聚焦回歸涵蓋 legacy Google、已設定／未設定 LINE、目前管理者無備用身分、最後入口、臨時開／關 override、完整 OAuth-only 與原子 catalog/audit。
- 本機實際 PostgreSQL＋API：未連結管理者拒絕；合成 legacy Google fixture 後可關閉；同時移除兩入口僅一筆成功；注入 audit failure 後 override 回滾。這是合成本機身分，不是真實 Google 授權。
- 四個固定本機角色登入與 session 查詢成功；Kitchen 管理 API 依既有合約回 404 隱藏資源；錯誤 CSRF 403；一般 password POST 在關閉後 403。
- Chrome 實測：取消不寫入且回復焦點；確認成功；重新整理仍關閉；最後 Google 入口不可移除且有錯誤視窗；Escape 可取消。
- 商家／店員登入在 320/390/768/1440 無水平溢出；兩個入口六語系於 320px 保留 Google 並移除密碼。管理開關皆 44px，錯誤／確認視窗在手機可見。
- 完整 gate、commit、CI、Preview 及 release 狀態以本次不可變收據為準；上述本機證據不表示已關閉正式站密碼登入。

本機測試使用獨立 DB `stallorder_auth_methods_20260914`（既有本機 catalog DB 容器中的獨立資料庫），不修改原本保留的 QA DB，也不匯入 Production 資料。開發服務固定 `127.0.0.1:3020`；完成後依服務生命週期停止本次啟動的 app，保留資料供追查。

完整重建另用 `stallorder-auth-policy-20260914` 獨立 Docker project：146 個 migration 完整套用、72 檔／1,619 項 pgTAP 通過、DB lint 無 schema error。Windows checkout 的 CRLF 曾使既有 SQL 文字 anchor 比對失敗；只將測試副本還原成 LF，146 檔逐一比對 Git blob 全相符後重建成功，repository migration 完全未改。此專案的 db/kong/storage 測試完成後停止，保留 container、volume 與資料；可由本次測試目錄的 config 恢復。正式 DB 與既有本機容器未停止。

`npm ci` 完成後 Production build 通過。兩次四 worker 全測在不同既有 delivery webhook 動態載入階段遇到 5 秒逾時，當時本機可用記憶體約 2.1 GiB；未提高 timeout、略過或修改測試。以 `npm test -- --maxWorkers=1` 重跑全部測試：3,251 通過、9 原有略過，545 測試檔通過。UI audit 330 TSX、dependency audit 0 vulnerabilities；五項既有 Next navigation lint warnings 未混入本次修正。

## 正式 LINE Login 尚缺的項目

2026-09-14 Console 唯讀檢查：「StallOrder 正式登入」仍為 Developing，LINE Login callback 欄位未設定。Production 新 OAuth registry 的 LINE 亦未 configured。2026-09-13 在隔離 paired Preview 的真實 LINE callback/session 驗收已成功並完成暫存資源清理，但不能套用成 Production 驗收。

正式啟用需：完成正式 Channel Web callback `/api/auth/line/callback`、正式部署限定的 Channel ID/Secret／state secret、Channel 可用狀態、已驗證應用發布，再由受稽核介面啟用與執行真實正式登入。不要把顧客訂單通知 callback `/api/public/line/callback` 混作商家登入 callback；不搬用 TEST 憑證，也不自動按 Email 連結既有管理者。

## 商家 LINE 登入不能代替 OA 管理授權

個人 LINE Login 驗證使用者，並不授權列出或管理該使用者擁有的官方帳號。Login Channel 連結固定 OA 與 `bot_prompt` 的用途是邀請加好友，不是讓 StallOrder 取得所有商家 OA 的 Messaging API 權限。

現行做法是在「LINE 訂單通知」完成一次 OA/Messaging API 與同 Provider Login 設定，安全保存憑證，日後一般登入不用重做。注意：現行設定 UPSERT 要求完整三項憑證；修改通知設定時仍須重填有效原值，不能宣稱已完成免重填偏好設定 API。

更接近一鍵串接的官方方案是 LINE Module：具備核准資格後，商家由本站開始 OA 授權、選擇 OA、同意權限，再由系統保存綁定。這不是一般 LINE Login 自動附贈的能力，也不是零同意流程。目前官方文件要求企業申請並敘述 LINE Marketplace 的發行限制；技術文件中的 `region=TW` 不表示 StallOrder 已具備商業資格。此方案僅評估，未實作、未申請、未啟用。

官方來源（本次以 AnySearch 查核）：[連結 OA／加好友](https://developers.line.biz/en/docs/line-login/link-a-bot/)、[LINE Login API](https://developers.line.biz/en/reference/line-login/)、[Module 資格與限制](https://developers.line.biz/en/docs/partner-docs/module/)、[Module OA 授權流程](https://developers.line.biz/en/docs/partner-docs/module-technical-attach-channel/)。

## 發布與回復

先完成本機 gate、精確 PR head 的 CI／隔離 Preview、Staging tree 驗證與新的 application-only Production Plan；Apply 須綁定新收據核准。此修正沒有 DB schema、Edge Function、DR 或使用者帳號異動。

關閉正式密碼前須重新證實目前管理者的 Google 入口可用，並記錄 alias/deployment/backend 健康基準。回復優先由有登入身分的管理者以受稽核開關恢復；如需 deployment rollback，必須選已重新驗證且相容的 artifact。舊程式不認得新 flag，回滾可能重新顯示密碼入口，需明確驗證而非聲稱政策仍被舊版本強制執行。
