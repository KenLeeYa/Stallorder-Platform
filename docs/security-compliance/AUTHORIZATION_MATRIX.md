# 授權矩陣
| 行為 | 訪客憑證 | 本人session | Organization owner | Platform support |
|---|---|---|---|---|
| 提出請求 | Canonical Circuit B核對單一訂單 | active org/stall membership＋CSRF，固定本人 | 同左，不冒名 | 無額外冒名權 |
| 查進度 | receipt＋org、同源限流 | 同左 | 五筆分頁摘要 | owner grant、指定租戶、最長1小時，只讀摘要 |
| 檢視details／核准／準備複本 | 拒絕 | 不具管理權則拒絕 | active session/membership＋fresh MFA action/tenant/content/session proof | 拒絕 |
| 領取複本 | 已核對訂單receipt | 本人當前有效session＋receipt | 不代領他人資料 | 拒絕 |
| 刪除／保全解除 | 僅申請 | 僅申請 | 核准policy、終態、hold、fresh plan、MFA、dry-run OFF | 拒絕 |
| support核准／撤銷 | 拒絕 | 拒絕 | 禁自批；指定platform admin；撤銷立即生效 | 不可自批延長 |
| 事故記錄 | 拒絕 | 拒絕管理權 | scoped owner，版本/狀態機/證據 | support grant不給寫入 |

既有訂單/退款/成本/報表權限仍走原RBAC/entitlement，不因新增治理功能擴權。body strict，查詢條件不覆寫server scope。新交易SET LOCAL app.compliance_organization_id。

實際lab postgres與service_role是BYPASSRLS；anon/authenticated不是。另在transaction建立NOLOGIN NOBYPASSRLS角色，測試無scope及跨org SELECT/UPDATE拒絕，最後rollback。這只證明新表policy，不能稱現有Prisma已全面使用非bypass角色。正式前須驗Prisma/worker/view/RPC/Storage/Realtime及pool並發撤權。

MFA驗證既有Supabase身分與真實簽章，不接受自報aal2；fixture grants只用於本機消耗與scope測試。未配置provider或身分連結時保持敏感操作關閉。最後owner與恢復沿用既有程序，不新增免MFA後門。
