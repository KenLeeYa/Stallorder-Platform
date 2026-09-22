# 漸進發布與回復

## 本次界線

UI/UX 工作留在 `codex/ui-ux-redesign-20260923`。未 push、未發布、未修改 Vercel／Cloudflare／Supabase 正式資源。沒有 migration，沒有新增金流／列印／DR writer；Docker 僅本機 QA 用途。

本機成功不等於正式完成。正式基準為盤點當時的 `5cc15c6`，未來發布前必須重讀當時的實際 deployment／aliases／backend，不能直接使用這份舊快照回復。

## 分批

1. 合併至 Staging 前，重跑型別、lint、相關測試、build、權限、售完／原單修改／列印復原與視覺流程；保留精確 commit/tree。
2. 先測單一受權示範商家，手機／平板／桌機各完成一筆含客製訂單及故障復原。本次沿用 `src/server/resilience/feature-flag-service.ts`，新增 `STAFF_WORKSPACE_REDESIGN_ENABLED`，預設 false，只控制店員清單分頁／篩選／付款列印摘要，不控制任何 server transaction guard。
3. 再對三間試用商家逐步啟用。未啟用攤位維持原清單及操作；旗標查詢失敗也回到原清單。其他本輪商品、欄位與無障礙修正隨候選版本生效，不在此旗標範圍。已通過本機真實管理者 API 開啟→回退→再次開啟、401／404 與訂單不變檢查；尚未修改正式旗標。
4. 只有本次功能驗收與受保護發布流程均通過，才發布 Primary；DR 另讀取明確 project/deployment，禁止繼承未指定的 `VERCEL_PROJECT_ID`。

## 停止擴大／回復條件

新單無法成立、修改導致重複單／價金改變、付款未知被要求重新付款、同一工作重複出單、列印成功仍擋完成、跨租戶可見、資料／按鈕被遮蔽、主要鍵盤流程失效，均立即停止擴大。

本機可停止 3023，再切回相容已驗證的來源。正式必須依 `docs/PRODUCTION_ROLLBACK.md` 和 `docs/incidents/2026-09-12-dr-production-outage.md` 回復已驗證 artifact；不能只撤 alias 就稱恢復。無 schema change 使本次 presentation 可回退，但仍須確認其他同時發布的後端版本相容。

## 店員工作台旗標契約

既有服務支援 GLOBAL、ORGANIZATION、STALL、DEVICE、PERCENTAGE，帶到期時間與異動理由。本輪只在授權後的 staff page 傳入真實 organizationId／stallId；不用 query、localStorage 或顧客輸入決定範圍，也不借用 `ROLLING_RELEASE_ENABLED`／DR／付款旗標。

正式啟用前，先在 Staging 的既有 `resilience_feature_flags` 設定目錄登錄下列項目，再以既有受保護發布流程同步設定：code 為 `STAFF_WORKSPACE_REDESIGN_ENABLED`、description 為「店員工作台分頁、篩選與摘要」、default_enabled=false、is_emergency=false。未登錄時安全回到 false，沒有 schema migration；不得用整份本機 seed 覆蓋正式設定。

設定入口為既有 `PUT /api/admin/resilience/feature-flags/STAFF_WORKSPACE_REDESIGN_ENABLED`，需要平台管理者 session、同源與 CSRF。啟用時使用 STALL、該商家的 organizationId／stallId、enabled=true 及至少五字的理由；API 驗證攤位歸屬並寫 audit。停用同一 scope 設 false，不刪訂單／列印工作。優先使用攤位範圍，避免任意全域啟用。

旗標在載入 staff page 時決定；現有服務快取最長兩秒。操作中的視窗不會被強制切版，完成目前動作或查清未知交易結果後再重新整理，核對五筆分頁出現／消失。程式不會為切版重送交易。旗標查詢錯誤僅記錄固定事件 `STAFF_WORKSPACE_FLAG_FALLBACK` 與 legacy 結果，不輸出例外內容或連線密鑰。

## 必要外部／人工驗證（集中交接）

| 項目／位置 | 值或權限來源 | 驗證 | 回復 |
|---|---|---|---|
| Staging／Production 發布 target | 當時 provider project ID、deployment、alias 實讀 | 登入、店員、有效 QR、外帶、改單、列印流程與 backend readback | 已驗證且相容的 artifact；保護 Primary，DR 另行協調 |
| 真實印表機、Star webPRNT／藍牙 | 商家既有設定與已配對裝置；不在聊天提供密鑰 | 原票／增刪變更票／重印失敗復原、份數、餐具資訊、完成訂單 | 還原商家原列印路由，不重建交易 |
| Android／iPad Web Push、背景／鎖屏 | 裝置瀏覽器／OS 通知權限、可信 HTTPS、既有 VAPID | 訊息、去重、系統聲音與前景聲音分測 | 關閉該裝置訂閱；不替換共用密鑰 |
| 真實支付／退款、錢櫃／發票／外送 provider | 既有 sandbox/測試帳號、服務商受權設定 | 使用 sandbox 走實際 provider callback／查詢，核對不重複收款 | provider 既有回復流程，不任意更改狀態 |
| 螢幕閱讀器與原生 200% zoom | Windows NVDA／Android TalkBack／iPad VoiceOver | 標題、狀態、錯誤定位、dialog 焦點、表格精確數值 | 保留原路由與 presentation 回退；問題列 P1 |

這些項目未完成不會阻止本機 UI 實作；它們會阻止「全系統／正式環境已完整驗收」的宣告。
