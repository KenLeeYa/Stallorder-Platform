# LINE v2 帳號設定與唯讀 API 驗證

日期：2026-09-28（Asia/Taipei）。候選程式 `d7d67c7aef0dc408f75d3ce48ed2c5564cf1b157`，工作樹 `line-miniapp-pay/Stallorder-Platform`，分支 `codex/line-platform-oa-v2-20260927`。本次只新增外部測試帳號設定與文件，沒有改應用程式、套遠端migration、發布正式站或替換3023。

## 已完成並讀回的設定

| 項目 | 真實結果 | 驗證限制 |
|---|---|---|
| 平台 OA | 攤點通 `@028sijlm`，輕用量方案，尚未認證 | 新建成功不等於OA認證通過 |
| Provider | StallOrder `2005461563`，管理員可查看 | 法人／Certified Provider狀態仍未核准或驗明 |
| Messaging API | Channel `2011762548`，Manager顯示使用中，Developers歸屬正確Provider | Webhook尚空；尚未匯入應用Vault |
| API身份 | `GET /v2/bot/info`確認basicId及名稱，保存正確bot destination | 沒有把人員userId混作bot destination |
| 訊息格式／額度 | `POST /v2/bot/message/validate/push` HTTP 200；額度200，用量0 | 沒有傳送訊息；格式驗證不證明收件／QR呈現 |
| MINI App | Taiwan／攤點通／同Provider草稿已填，未提交 | 自己的條款及代表權聲明待使用者回覆，無MINI／LIFF ID |
| Pay Sandbox | 既有測試商家登入、郵件OTP完成，Channel `2011753464` | 測試商家不是越好吃正式線上收款資格 |
| Sandbox API | 依v4規格簽章唯讀`GET /v4/payments`，以新探測orderId查詢；HTTP 200、1150 Transaction record not found | 零交易建立；Request／授權／Confirm／退款均未驗 |

官方API的脫敏收據：[line-v2-provider-connection-20260928.json](../../../artifacts/line-v2-provider-connection-20260928.json)。探測回覆時間為2026-09-28 06:49:20（台北）。

## 同意與憑證界線

- 使用者已分別同意OA建立條款／隱私權、首次資訊使用約定、[官方帳號API服務條款](https://terms2.line.me/official_account_api_terms_tw)與既有Provider綁定。
- 使用者已核准建立平台Messaging長效權杖，將OA Secret／Token及既有Pay Sandbox Secret存入 `C:/Users/KY/.codex/private/stallorder-line-test/line-test-settings.json`。目錄及檔案ACL讀回僅MSI/KY與SYSTEM，無其他群組或繼承存取。未存登入密碼，未將憑證放Git、文件或正式環境。
- 此檔為受NTFS權限保護的本機JSON，不宣稱已在Vault或有額外檔案加密。應用仍須依既有部署流程匯入隔離Vault與店別版本化secret；不把raw token放進binding JSON。
- 未發送廣播或測試Push、未發起真實或Sandbox付款／退款、未加購方案、未申請OA／Provider／MINI認證。商家OA與現有正式Login Channels保持原樣。

## 必要外部驗收仍未完成

依 [外部設定清單](EXTERNAL_SETUP_CHECKLIST.md) 處理：MINI條款及建立、合法營運主體與公開政策、受控HTTPS Preview、Vault／Webhook／排程、測試顧客好友與通知同意、双店Sandbox收款隔離、iPhone／Android LINE與獨立店員裝置掃碼。

台灣目前官方流程允許先開發MINI，CP為Verified送審條件；不能把缺CP當作所有Developing建立都不可行。官方Policy尚有不同步文字，詳 [官方查核](TAIWAN_MINIAPP_REQUIREMENTS_20260928.md)。

本次未改程式，不重跑未受影響的615項本機測試；歷史本機結果仍見 [測試報告](TEST_REPORT.md)，不改記為當日真實LINE／Pay流程通過。

## 正式站及本機服務

- 操作前後`vercel inspect https://app.qidaigo.com --scope ada76145-8663s-projects`均解析至Primary `stallorder-platform`、Production `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`、Ready。本次無Vercel、DNS、DR或遠端DB寫入。
- 結束檢查：`/login`、`/staff/login`、`/store/viet-food-yc`均200；`/api/health/`導向`/api/health`後匿名401。未取得已登入health、backend target或真實正式下單證據，因此不宣稱完整正式流程已驗。
- 本次沒有啟動測試服務。3023 listener仍為PID49312；3024無listener；55722的catalog-ops DB仍healthy、供原人工QA使用，沒有停止共用Docker或刪除資料。
