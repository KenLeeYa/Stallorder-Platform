# Supabase 環境矩陣

任何兩個執行環境都不得共用 API key、Auth user、Storage、database password、Edge secret 或 Turnstile secret。Production Primary 與 Production DR 可依核准的單向複寫契約共享業務資料，但仍是兩個獨立專案與秘密邊界。

| 環境 | Application URL | Supabase 目標 | Project ref | Git source | 資料／寫入規則 | Turnstile／Origin |
| --- | --- | --- | --- | --- | --- | --- |
| Development | `http://localhost:<port>` 或核准的同網段本機 QA URL | 本機 Supabase CLI | local | feature branch | 僅本機 fixture；不可連 Production Primary／DR | 只允許明確本機 QA policy |
| Ephemeral Preview | 與 Pull Request 配對的 Vercel Preview URL | Data-less Supabase Preview Branch | 每次動態建立 | same-repository PR | `with_data=false`；只載入 deterministic synthetic fixtures；PR 關閉後刪除 | 精確 Preview hostname；秘密不持久化 |
| Source-tree gate | 無 persistent runtime | 無 remote database | n/a | `staging` | 只作 promotion gate；不得重新連到舊 Staging／DR 專案 | n/a |
| Production DR | 尚無一般公開 URL；規劃 `https://dr.qidaigo.com` 僅供受保護 operator validation | `stallorder-dr`，former Staging project | `daeqwtpaxcebmtwxqdkj` | verified `main` tree | `READ_ONLY_STANDBY`、writer fenced；只接受核准的 Primary 單向複寫；不得載入 Preview fixture | DR 專用 Auth／Storage／Edge secrets；hostname 未 provision 前不得宣稱通過 |
| Production Primary | `https://app.qidaigo.com` | `stallorder-production` | `eyuctbnlvnbnivwasvqr` | `main` | 唯一正常 writer；禁止 demo seed／remote reset | `app.qidaigo.com` 與精確 Production origins |

## 資料規則

### Development

- 可使用本機 seed、demo accounts、demo QR 與 Turnstile test key。
- `LOCAL_DEV_ALLOWED_ORIGINS` 只在非 Production 生效；不得把本機 bypass 帶入部署。

### Ephemeral Preview

- 不複製 Production 顧客、Auth user、Storage object、付款參考、session 或 provider secret。
- Preview 必須使用同一 PR 的動態 Supabase Branch 與 Vercel Preview，不得連到 Production Primary 或 DR。
- GitHub `staging` branch merge 不建立 persistent database 或固定 hostname。

### Production DR

- former Staging 專案已轉為 DR；不得再稱為 Staging、接收 synthetic test data，或綁定 `staging.qidaigo.com`。
- Schema、RLS/grants、Auth identity mapping、Storage manifest、Edge Functions 與 replication readiness 必須由最新 immutable evidence 證明，不在本表硬編容易過期的 migration／relation 數量。
- `dr.qidaigo.com` 只有在 DR-configured deployment、access protection、backend identity、promotion epoch、Turnstile/origin/callback 與 fence 驗證完成後才可建立。

### Production Primary

- 不執行 `supabase/seed.sql`、`prisma/seed.ts`、`db reset` 或 `db push --include-seed`。
- 不建立 demo account、demo QR 或 synthetic customer order。
- `TURNSTILE_ALLOW_TEST_KEYS=false`、`ALLOW_DEMO_SEED=false`。
- 所有 application-owned table 必須維持既有 RLS、grant 與 tenant authorization 防線。

## 狀態更新責任

建立或移除專案、Preview、migration、Edge Function、網域、Turnstile、Auth callback 或 DR 複寫後，同一次變更必須更新本矩陣、受影響 runbook／ADR，以及 `ARCHITECTURE_AND_FEATURE_CHANGELOG.md`。只記錄名稱、角色、狀態與不可變證據，不寫入 key、password、connection string 或 secret。
