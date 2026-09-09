# 滿版形象登入頁（2026-09-09）

狀態：Implemented。正式發布須以本次相同 commit/tree 的 CI、配對 Preview、Production Application Release Plan/Apply 收據及上線回查為準。

## 使用者接受的呈現

形象圖填滿登入視窗，真正可操作的登入文字與按鈕位於中央平板螢幕內。商家 `/login` 與員工 `/staff/login` 使用同一個 `LoginShell`，保留各自的角色標題與說明。這只取代登入頁原本置中的登入卡片，不啟用先前獨立保留的全站介面重設計。

`picture` 依 4:3 視窗比例選用橫式或直式 WebP。場景維持原始比例並依視窗裁切，平板位置以對應圖片的內螢幕邊界定位；登入文字由 HTML 呈現，可選取、翻譯、聚焦與操作。手機背景使用同場景直式版本，移除易被裁切的浮動大字，保留實體品牌招牌。橫式素材 1672×941、175242 bytes，直式素材 941×1672、157226 bytes；每次只載入符合比例的素材。圖片為此次使用者委託生成，原稿另行保留。

## 互動與相依界線

- 小螢幕、多個登入 provider、錯誤提示或文字放大時，顯示區內部可以捲動。操作工具列位於螢幕外，保留首頁、語言與深色模式控制。
- 密碼登入沿用原生 dialog 的 top layer；限制最大高度以容納短螢幕，關閉與送出控制保留至少 44px。開啟聚焦電子郵件、Escape 關閉、焦點返回入口。
- 深色模式變更真正的螢幕與工具列表面，背景照片保持一致。圖片替代文字涵蓋既有六種介面語言。
- 登入 provider、OAuth-only／legacy policy、商家申請 URL、`next`、錯誤代碼、session 確認與本機測試帳號的 Production 限制全部沿用既有伺服器及認證實作。
- 沒有 schema/migration、Supabase Edge Functions、環境變數、金流、訂單或供應商整合變更。

## 驗收與發布

發布前 npm audit 回報 7 個相依性問題（1 Critical、4 High、2 Moderate），因此先停止遠端推送。此次一併更新 Next.js／eslint-config-next 至 16.3.4、sharp 及既有 override 至 0.35.4 系列、Vitest 至 4.1.11 系列，並在原有相容範圍更新 js-yaml 鎖定版本。沒有使用 `npm audit fix --force`、降級 Wrangler 或放寬 audit 門檻；更新後必須重跑完整檢查與建置。

修補依據為維護者的 [Next.js Windows 公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)、[Next.js AVIF 公告](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)、[sharp 公告](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)、[Vitest 公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) 與 [js-yaml 公告](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh)。這是解除此次發布安全阻擋所需的相依性修補，應用程式行為仍限於上述登入頁呈現。

穩定規則：`LOGIN-001`、`QA-LOGIN-01`，相依 `ADM-005`、`ADM-007`。

- `e2e/login-smoke.spec.ts`：兩種入口於 320/390/768/1440px 的圖片載入、滿版覆蓋、平板可達、內部捲動、44px 入口與無水平溢位；保留原有焦點、dialog、Owner/Staff 真實 session 案例。
- `src/components/login-form.test.tsx`、`src/lib/login-routing.test.ts`、`src/lib/message-catalog.test.ts`：角色、語系、provider、申請 URL、錯誤映射及路由。
- 最後候選另檢查橫式手機、寬螢幕、六語、深色模式、200% 文字與 API 錯誤後的輸入及 next 保留。未連接 DB 的本機 UI 測試不能代替配對 Preview 的真實登入流程。

360×740px 且顯示 Google 入口時，瀏覽器將帳密按鈕捲到可視區邊緣會產生 0.296875px 的底部裁切。CI 與配對 Preview 均已重現；螢幕捲動容器保留 12px `scroll-padding-block`，使按鈕捲入完整可視範圍。原本的完整按鈕邊界、鍵盤焦點及 dialog 斷言維持不變。

本次應用程式發布使用既有 `.github/workflows/production-application-release.yml`，由新的 main/staging 同樹 Plan 綁定 Apply。它先建置未綁正式網域的 Production deployment，通過 smoke 才 promote，正式 smoke 失敗時依既有 workflow 回復 alias。未包含資料庫／Edge 變更，因此不執行它們的 Apply。配對 Preview 與 CI 仍保留隔離資料庫及完整相依回歸；發布後核對實際 deployment SHA、Plan ID、正式登入畫面與 health，另讀取 DR readiness，不將歷史收據當成本次證據。
