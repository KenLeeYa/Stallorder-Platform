# 商家申請 RLS

## 資料表

| Table | RLS | Anonymous | Authenticated read | Direct write |
| --- | --- | --- | --- | --- |
| `merchant_applications` | ENABLE + FORCE | 無 | 申請者本人或 Platform Admin | 無，僅 service role |
| `merchant_application_notifications` | ENABLE + FORCE | 無 | notification owner 或 Platform Admin | 無，僅 service role |
| `merchant_setup_progress` | ENABLE + FORCE | 無 | Organization member 或 Platform Admin | 無，僅 service role |

`merchant_applications` 對 authenticated 只授予公開欄位的 column-level `SELECT`；不授予 `internal_review_note`、risk reasons、來源雜湊、reviewer internal fields 或 consent security metadata。

## Helper 與 scope

- Applicant policy 使用 `is_current_profile(applicant_profile_id)`。
- Platform review policy 使用 `is_platform_admin()`。
- Setup policy使用 `is_organization_member(organization_id)`；Next.js 另以 Owner RBAC 限制 mutation。
- Prisma 寫入只在受信任 server service 執行，瀏覽器沒有 service role 或 database URL。

## 為何不開放 Applicant UPDATE

申請者雖可編輯 DRAFT／NEEDS_INFO，但必須經 `/api/onboarding` 的 Origin、CSRF、Zod、rate limit、duplicate/risk 與 state-machine 驗證。RLS 不提供直接 `INSERT/UPDATE`，可避免繞過 trusted transition。

## pgTAP 證據

`supabase/tests/database/merchant_application_setup.test.sql` 驗證：

- 三張新表啟用並強制 RLS。
- Anonymous 無讀取權。
- Applicant 只能看自己的申請，且無 internal note 欄位權限與 direct write。
- Platform Admin 可跨申請審核。
- Organization setup 不可跨組織讀取。
- 未完成測試訂單無法標記 Go-live。
- 測試訂單不建立 usage event，也不進 daily revenue summary。
