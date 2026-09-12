# 本機勾選介面與角色快速登入

2026-09-11，僅本機人工 QA。使用者要求提供測試環境，因此保留本次服務運行；人工測試結束後依 [服務生命週期](LOCAL_TEST_SERVICE_LIFECYCLE.md) 停止。

## 入口

- 登入：http://127.0.0.1:3018/login
- 員工登入：http://127.0.0.1:3018/staff/login
- 顧客 Menu：http://127.0.0.1:3018/store/aming-01?view=menu
- A1 桌內用 QR：http://127.0.0.1:3018/q/demo-aming-chicken-table-a1-qr-2026
- 外帶自取：http://127.0.0.1:3018/store/aming-01?view=pickup
- 外送入口：http://127.0.0.1:3018/store/aming-01?view=delivery

四個快速登入按鈕不需輸入帳密：

| 按鈕 | 預設目的地 |
| --- | --- |
| 商家 | 示範商戶營運總覽 |
| 店員 | 阿明鹽酥雞店員訂單看板 |
| 廚房 | 阿明鹽酥雞廚房看板 |
| 平台管理者 | 平台帳務管理 |

保留資料庫中的其他商戶、既有訂單與權限。原本測試帳號具多商戶權限，未帶 next 的快速登入會停在商戶選擇頁；現在各本機按鈕提供示範資料的預設目的地。若使用者從受保護頁面返回登入，明確指定的 next 仍優先。一般帳密與 OAuth 的預設導向未改動。

快速登入仍要求 development、明確本機旗標、loopback 網址與資料庫、同來源請求及固定測試帳號；服務端照常驗證帳密、session 和頁面權限。此設定不是正式環境登入方式。

## 環境與保留服務

- 工作樹：`C:/Users/KY/Documents/Codex projects/Stallorder-Platform-order-selection-checkboxes-20260911`
- 分支：`codex/order-selection-checkboxes-20260911`
- 勾選介面基底：`75c4bef6d7a7dbbd15d5ac8345d52bb719fb1a49`
- Next 開發服務：3018；以專案既有 `scripts/start-local-qa.mjs` 啟動。
- 本次啟用且保留的 Docker 容器：`59f8e85233fa`，`supabase_db_stallorder-catalog-ops-20260907`，DB 55722。
- 公開點餐採本機 Circuit B，直接使用此資料庫；沒有為此啟動整組 Supabase。該組其餘 7 個容器保持停止。
- 兩組既有供應鏈環境及 KuanGuard 資料庫照原有任務保留；本次未停止或重啟。
- 付款與報表寄送沿用本機模擬設定；未驗證真實付款、外部 OAuth、LINE 寄送或實體印表機。
- 本次未重設、清空或重新播種資料庫。

## 啟動與停止

本機啟動器、程序紀錄與不含密鑰的驗證收據放在：

`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/quick-login-environment-20260911`

啟動器載入既有本機設定檔，檢查資料庫必須指向 loopback:55722，再以固定 3018 啟動。不將連線字串或密鑰寫入文件與紀錄。

重新啟動前先確認 3018 的服務所有者與資料庫 label；目前使用者仍在手動測試時不要重複啟動。停止時核對 `server-process.json` 的啟動器 PID 及其 command line，再只停止該程序樹；最後停止上述精確 DB 容器。保留容器、映像、volume 與所有測試資料。

## 驗證

- 重現：從純 `/login` 點店員，登入成功卻進入 `/select-organization`，直接進店員看板的回歸測試失敗。
- 修正後：商家、店員、廚房、平台管理者 4 個預設目的地、員工入口 2 個按鈕及明確 next 優先，共 7 項實際瀏覽器測試通過。
- 原本 readiness 測試使用主 QR，現有流程會回公開 Menu；改用保留的 A1 桌 QR 驗證內用點餐。Menu、A1 桌 QR session、外帶 session 與現金交班的實際 readiness 測試通過，兩個 session API 均回 HTTP 201。
- 320、390、768、1440 px 登入按鈕：無頁面水平溢出，觸控高度至少 44 px；4 個帳號皆回登入 HTTP 200、session HTTP 200。
- 登入表單、登入 API 與本機安全界線 24 項單元測試通過；變更檔 ESLint、TypeScript 與 diff 檢查通過。
- 本次沒有重新驗證整套交易、硬體與外部服務，也未進行正式部署。

