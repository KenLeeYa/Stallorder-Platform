# 現況稽核

日期：2026-08-26
來源基準：`origin/staging` commit `a1255970038110086bb1484a1a81bc0bee9db7ce`
隔離分支：`codex/competitive-enhancement-local-20260826`

## 工作區與基準

- 原工作區含使用者未提交內容，本次未在該工作區寫入。
- 本次使用獨立 Git worktree；下載的 Master Prompt 僅視為需求資料，不視為遠端部署、憑證或破壞性操作授權。
- 基準環境：Node.js 24.18.0、npm 11.16.0、Prisma 6.19.3、Supabase CLI 2.109.1。
- 基準結果：`npm ci`、lint、typecheck、2,360 個既有測試、build、UI audit 與 npm audit 均通過；完整結果以實作報告最後一次 Gate 為準。

## 已存在且重用的能力

| 領域 | 已有能力 | 本次處置 |
| --- | --- | --- |
| 核心訂單 | QR、店員點餐、雙路訂單入口、訂單狀態、付款與折扣 | 不改既有狀態機；以相容方式擴充 |
| 廚房與取餐 | KDS、工作站、取餐看板、列印、容量與等候時間 | 稽核並重用，不建立第二套 |
| 組織與權限 | Organization/Stall scope、RBAC、稽核事件 | 新 API 沿用 server-side 授權 |
| 穩定性 | Feature flag、Outbox/Inbox、idempotency、離線基礎 | 新模組預設關閉、外部能力 fail-closed |
| 整合 | LINE、付款、外送 Provider foundation、列印 | 集中到整合設定中心顯示真實狀態 |
| 報表 | 日結摘要、每小時、商品、付款、現金交班 | 進階分析重用既有摘要與 KPI 算法 |

## 本次新增的垂直能力

- 模組目錄與 `MODULE_*_ENABLED` Feature flags。
- 通路感知、可審核、可發布的版本化共用菜單。
- 會員優惠、集點、推薦、RFM 與自動化的治理資料基礎；顧客發送仍受同意硬鎖。
- Supply Lite 的食材、庫位、配方、不可變庫存異動與移動平均成本。
- 活動推廣、簽章連結與費用；訂單歸因寫入仍關閉。
- Scoped API Key、唯讀 v1 菜單 API、Webhook endpoint 與簽章基礎。
- KPI 字典、資料新鮮度與跨模組健康度。
- 整合設定中心及系統強化模組總覽。

## 明確未完成或受外部條件阻擋

- foodpanda、Uber Eats、正式金流、電子發票及 ERP 真實 Provider 驗證。
- 活動歸因尚未同時接通兩條公開下單路徑，因此不寫入 touchpoint/order attribution。
- Webhook 對外投遞維持停用，待固定 egress、DNS rebind 防護及 Sandbox 驗證。
- 顧客行銷發送維持關閉，待同意版本、退訂、留存與刪除流程完成法務／隱私核准。
- 本次只做本機；未執行 GitHub、DR 或 Production 操作。
