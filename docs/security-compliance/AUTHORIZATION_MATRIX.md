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

## 2026-09-30 v2.0 同步（本機，未發布）

| actor | scope/action | 必要限制（待驗證） |
|---|---|---|
| 商家管理者 | 自店 OA／Mini Store／Pay 選配 | 三開關獨立；不能讀回明文或操作別店 merchant |
| 平台管理者 | 指定店 webhook 遠端 read/test/apply/compare | 最小權限、套用前版本與環境核對、敏感操作 step-up、精確 URL 允許範圍、稽核 |
| 通知 worker | 單事件 order/stall/channel/sender/recipient | 發送前撤權／目的／開關／版本再核；不能任意選收件人 |
| 顧客／員工 | 取餐卡預覽／同店核銷 | GET 不改狀態；POST 角色、店、版本及原子核銷 |
| 承運者／外部 POS | 指派任務／明確授權交易 | 撤權、重派後舊裝置及附件補傳拒絕 |

對應 T71–T80，不能以需求表當作現有權限測試通過。
