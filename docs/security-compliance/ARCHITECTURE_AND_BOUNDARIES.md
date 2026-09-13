# 架構與信任邊界
維持 Next.js 模組化單體、Supabase/PostgreSQL、Prisma、Organization/Stall、QR /store/{stall.code}、POS/KDS、CloudPRNT/webPRNT、支付、Supply Lite 與 PAYG。沒有新增 OMO、原生App、AI產品、代收／錢包。

~~~mermaid
flowchart LR
  G[訪客 QR 追蹤憑證] --> B[同源 限流 Canonical Circuit B]
  M[商家 session CSRF] --> A[即時 session membership]
  B --> P[Privacy service 主體範圍]
  A --> P
  A --> S[既有訂單 支付 庫存 PAYG]
  MFA[既有 Supabase MFA] --> U[短效單次 action content session proof]
  U --> P
  P --> T[同一交易 治理資料 Audit Outbox]
  T --> DB[(Primary 唯一 writer)]
  S --> DB
  DB --> DR[(非同步 DR 本地寫入 fence)]
  T -.待設定與回讀.-> W[獨立簽章封存 WORM]
~~~

| 威脅 | 控制／限制 |
|---|---|
| 偽冒／升權 | server membership；strict body；JWT issuer/audience/sub/aal/amr；禁自批support；MFA不新增恢復後門 |
| 竄改／重播 | 複合FK、row lock、expectedVersion、payload digest、一次性proof及既有canonical transaction |
| 否認／稽核遺失 | 同交易audit/outbox；已提交audit拒絕UPDATE/DELETE/TRUNCATE；同交易補完快照允許 |
| PII揭露 | 最小projection、no-store、AES-GCM scope AAD、receipt不放URL、即時撤銷匯出 |
| 耗盡資源 | 既有多維限流/圖片像素/queue；治理body及五筆分頁上限；外部未知目標BLOCKED |
| 用途及保留違反 | 既有CRM purpose/consent；版本保留、scope/class hold、tombstones、還原前再刪除/撤銷 |

目標外部邊界：非bypass runtime、獨立KMS/封存、受控egress、Storage/Auth完整restore與provider實測。虛線非已完成串接。支付仍由商家直接收款；前端role、metadata、entitlement、mirror資料不是授權來源。部署身份要provider readback，不能只看本機config。
