# StallOrder 攤位點餐

StallOrder 是供夜市攤位、餐車、市集商戶、快閃店與小型餐飲業者使用的多租戶 QR Code 點餐 SaaS。介面為台灣繁體中文，訂單以人工確認、現金付款與取餐碼驗證為核心。

## 已完成範圍

- 靜態印刷 QR Code 與 10 分鐘短效訂單 session
- Cloudflare Turnstile 伺服器端驗證
- IP、裝置、QR、session、攤位及行為頻率多維限流
- `WAITING_CONFIRMATION` 員工接單流程與未確認自動逾時
- 六位取餐驗證碼與人工現金結帳
- 商品供應／售完、攤位暫停／關閉及 QR 撤銷／輪替
- 每攤位可設定數量、種類、備註、待確認與時間窗上限
- 商戶申請、資料庫式登入 session、RBAC 與 CSRF
- PostgreSQL 全業務表 RLS、匿名零寫入權限及租戶資料隔離
- `public_order_attempts`、audit log、JSON stdout 與健康檢查

## 技術架構

- Next.js 16、React 19、TypeScript、Tailwind CSS
- Supabase PostgreSQL、Edge Functions、RLS、pg_cron
- Prisma 供受信任的商戶／員工 Next.js 後端使用
- Zod、bcrypt、Vitest、pgTAP

公開瀏覽器不持有 service role key，也不能直接寫入 `orders`。掃碼 session 與公開訂單只由 Supabase Edge Functions 呼叫受限的 `SECURITY DEFINER` RPC 建立；價格、數量限制、攤位狀態與 session 消耗皆在同一資料庫交易重新驗證。

## 本機啟動

需求：Node.js 22 以上與 Docker Desktop。

```powershell
npm install
Copy-Item .env.example .env
npx supabase start
npm run db:reset
```

將 `.env` 的 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 設為 Cloudflare 測試 site key，並由 `supabase/functions/.env.example` 建立忽略版控的 `supabase/functions/.env`。本機可使用 Cloudflare 官方測試組合；`TURNSTILE_ALLOW_TEST_KEYS` 僅限本機為 `true`。

分別啟動：

```powershell
npm run functions:serve
npm run dev
```

預設網址為 `http://localhost:3000`。若連接埠已占用，可用 `npm run dev -- -p 3001`，並將同一 Origin 加入 `NEXT_PUBLIC_APP_URL` 與 `PUBLIC_APP_ORIGINS`。

示範帳號密碼為 `StallOrderDemo!2026`：

- 商戶擁有者：`owner@stallorder.test`
- 店員：`staff@stallorder.test`
- 廚房：`kitchen@stallorder.test`

示範 QR 路徑：`/q/demo-aming-chicken-qr-2026-rotate-me`。

## 驗證指令

```powershell
npm run lint
npm run typecheck
npm test
npm run db:test
npx supabase db lint --level warning
npm run build
npm audit --audit-level=moderate
```

## 正式部署

1. 建立 Supabase 專案並執行 `supabase db push`。
2. 部署三支公開 Edge Function，且維持 `verify_jwt = false`；它們自行執行 CORS、Turnstile、session 與 rate limit 驗證。
3. 以 `supabase secrets set` 設定 `ABUSE_HASH_SECRET`、`TOKEN_DERIVATION_SECRET`、`TURNSTILE_SECRET_KEY`、`TURNSTILE_EXPECTED_HOSTNAME` 與 `PUBLIC_APP_ORIGINS`。
4. 正式環境必須設定 `TURNSTILE_ALLOW_TEST_KEYS=false`，且不得使用 Cloudflare 測試金鑰。
5. Next.js 設定 `DATABASE_URL`、`DIRECT_URL`、`NEXT_PUBLIC_APP_URL`、`NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY` 與 `AUDIT_IP_HASH_SECRET`。
6. 只有在上游代理會覆寫而非附加用戶輸入的 IP header 時，才設定 `TRUST_PROXY_HEADERS=true`。
7. 將 Next.js 與 Edge stdout 匯入集中式日誌服務，並依 [MONITORING.md](docs/MONITORING.md) 建立告警。

正式環境不得執行示範 seed，也不得提交任何 `.env`。完整安全設計見 [SECURITY.md](docs/SECURITY.md)。
