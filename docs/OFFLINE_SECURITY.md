# 離線 POS 安全

## 信任邊界

瀏覽器與 IndexedDB 都不視為可信來源。離線 Permit 只授權受限的本機操作，
不能當作線上 bearer token，也不能繞過登入、CSRF、RBAC、RLS、方案權限、
stall scope 或同步時的伺服器重新驗證。

## 裝置核准

- 前端只可登錄目前登入 profile 的 installation。
- installation 已綁定其他 profile 或 stall 時回傳不存在，避免 IDOR 洩漏。
- 新裝置不能自我核准。
- 只有具備 `MANAGE_STALL` 的管理者可核准、指定 Leader、停用、撤銷或標記遺失。
- 角色或政策變更會在同一交易撤銷有效 Permit。
- 所有異動記錄 actor、request ID、IP hash、原因及 before/after。

## Permit

Permit 使用專用 `OFFLINE_PERMIT_SIGNING_SECRET` HMAC 簽署，最長 12 小時，
並綁定：

- Permit、device、profile、organization、stall
- roles 與允許動作
- menu snapshot version
- promotion epoch
- app protocol version
- storage class
- 伺服器核定的風險上限

資料庫只保存 token hash。禁止保存密碼、Google token、Session token、CSRF
token、service role key 或付款供應商憑證。

## 儲存能力

啟用前呼叫：

- `navigator.storage.estimate()`
- `navigator.storage.persisted()`
- `navigator.storage.persist()`

分類與行為：

- `PERSISTENT`：可取得政策核准的 Permit。
- `BEST_EFFORT`：Permit 最長 60 分鐘、最多 10 筆、累計 5,000、單筆 1,000，
  並與商家較低設定取交集。
- `INSUFFICIENT` / `UNAVAILABLE`：只允許唯讀，不發行 Permit。

IndexedDB 可能被作業系統清除；介面與文件不得宣稱永不遺失。

## 公開快照

公開物件只包含顧客本來可見的啟用菜單資料及售罄狀態。完整授權裝置快照不
直接公開。物件使用版本與 SHA-256 路徑、`application/json`、`nosniff`、
限制型 CSP 與 immutable cache。路由只接受固定 UUID/版本/hash 格式，
不接受客戶指定 origin，避免路徑穿越與 SSRF。

## Service Worker

- 不快取登入、Session、CSRF、訂單、付款、帳務、稽核或顧客資料。
- 不快取 authenticated HTML。
- 待同步資料存在時拒絕強制更新。
- 新版本不得在 IndexedDB migration 中刪除未知或尚未同步資料。

## OWASP 對應

- A01 Broken Access Control：伺服器 RBAC、stall scope、RLS、唯一 Leader。
- A02 Cryptographic Failures：專用 HMAC、token hash、禁止保存線上憑證。
- A03 Injection：嚴格 Zod、bounded JSON、固定 object path 與 MIME type。
- A04 Insecure Design：單寫入裝置、限時 Permit、風險上限、fail closed。
- A05 Security Misconfiguration：預設關閉、明確 Feature Flag 與環境變數驗證。
- A07 Authentication Failures：發行與同步皆要求有效線上 Session。
- A08 Integrity Failures：不可變 snapshot、SHA-256、protocol/schema version。
- A09 Logging Failures：裝置、政策、Leader 與 Permit 皆有稽核事件。
- A10 SSRF：公開快照 route 只使用伺服器設定的 Primary/DR origin。

## 尚未開放

P4 不接受離線訂單、不記錄離線付款、不執行同步。P5 必須再驗證 snapshot
價格、Permit、promotion epoch、idempotency、order state 與衝突，才能建立
正式 canonical order。供應商授權付款在任何離線階段均維持停用。
