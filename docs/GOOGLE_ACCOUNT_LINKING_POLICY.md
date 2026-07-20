# Google 帳號連結政策

## 身分來源

- StallOrder 內部主體使用 Supabase `auth.uid()` 對應 `Profile.authUserId`。
- Email 只作為已驗證屬性與邀請比對，不是資料庫主鍵，也不直接授予角色。
- 角色只來自 `Profile.platformRole`、`OrganizationMembership` 與 `StallMembership` 等可信任資料表。
- `user_metadata.role`、Google 顯示名稱、Email domain 皆不得用於授權。

## 自動連結規則

1. 相同 `authUserId` 的既有 profile 可繼續登入。
2. 僅有 Email 相同但持有密碼的既有帳號，不自動連結，避免帳號接管；需管理員核實後以受控流程處理。
3. 由邀請預先建立且沒有密碼、尚未綁定 `authUserId` 的 profile，可在已驗證 Google Email 相符時綁定。
4. Email 已綁定其他 Google identity、或 auth ID 與 Email 指向不同 profiles 時一律拒絕。
5. 新 Google 使用者只能建立沒有角色的 profile，再進入申請/待審流程。
6. disabled profile 即使 Google 驗證成功也不得建立 StallOrder session。

## 邀請安全

- token 使用高熵隨機值，資料庫只存 hash。
- 邀請需未過期、未撤銷、未使用。
- 已驗證 Google Email 必須精確符合標準化邀請 Email。
- 接受動作在 transaction 中一次性更新，並寫入成功或拒絕 audit event。
- Google 登入本身不會授予 STAFF、KITCHEN 或管理角色。

## 停用與撤銷

停用帳號時：

1. 將 profile 設為 inactive。
2. 刪除該 profile 的應用 `AuthSession` 記錄，使 StallOrder cookie 立即失效。
3. 視事件風險在 Supabase Auth Admin 撤銷 refresh sessions 或停用 Auth user。
4. 寫入操作者、原因、目標 profile 與結果的 audit log。

Supabase access token 在到期前可能仍存在，因此敏感操作必須持續以伺服器端應用 session、profile active 狀態、RBAC 與 RLS 驗證，不可只信任 JWT 中的舊 claims。

## 密碼登入遷移

現有密碼登入保留，直到 Staging 與 Production OAuth 驗證、帳號連結處理、復原程序與使用者通知完成。不得在 OAuth 首次登入時刪除 password hash。
