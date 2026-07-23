# Production Bootstrap

Production 不執行 `supabase/seed.sql` 或 `prisma/seed.ts`。所有 bootstrap 操作必須由受保護的管理流程、單一交易與 audit log 完成。

## 權限與事前條件

- 由兩位授權人員確認執行窗口、Production project ref 與 Vercel deployment。
- 建立第一個 Supabase Auth identity，驗證 email／OAuth，啟用可用的 MFA。
- 僅由受信任 server 將對應 profile 設為 `PLATFORM_ADMIN`；不要依賴 `user_metadata` 授權。
- 所有建立／變更記錄 operator、request id、before／after，不記錄 secret。

## 建立順序

1. 建立第一個 Organization：名稱／slug／聯絡資料，`status=ACTIVE`，時區 `Asia/Taipei`、幣別 `TWD`。
2. 建立第一個 Merchant profile 與唯一 primary `ORGANIZATION_OWNER` membership；owner 下拉值由系統鎖定。
3. 建立第一個 Stall，初始：

```text
business_status=CLOSED
ordering_enabled=false
ordering_state=CLOSED
is_sold_out=false
```

4. 建立 `MERCHANT_OWNER`／必要 stall membership，驗證只能看到所屬 organization/stall。
5. 建立商品分類、群組、商品、註記群組、選項價格與 stall availability；先維持不可公開接單。
6. 設定 ordering limits、營業日截止、付款、折扣、列印、語系與營業時間。
7. 建立專用 Production test stall／table／QR；QR 初始 `state=PAUSED`。
8. QR raw token 使用高熵 random bytes 產生，只顯示一次供列印；資料庫只存 hash 與 version。
9. 完成 RLS、Edge、Turnstile、staff、kitchen、cash checkout、report、alert、backup／restore 驗收。
10. 正式攤位逐項啟用：先 `business_status=OPEN`，再 `ordering_enabled=true`／`ordering_state=OPEN`，最後將核准 QR 設 `ACTIVE`。

## 專用測試資料

測試攤位名稱應明確標示 Production QA，預設 CLOSED／PAUSED，不出現在真實公開入口。測試完成後保留 audit trail；可撤銷 QR、停用攤位與身份，但不要破壞性刪除交易紀錄。

## 驗收與交接

- 驗證 PLATFORM_ADMIN、owner、manager、staff、kitchen、finance viewer 的 allow／deny matrix。
- 至少兩人確認 emergency pause、QR revoke／rotate、sold-out、close ordering。
- 將第一位 owner 的復原方式、值班聯絡、backup／rollback 權限存放在組織核准的密碼／事件管理系統，不放 Git。
- 完成 [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md) 後才讓正式 QR 進入 ACTIVE。

## Staging Google 平台管理員復原

`STAGING_PLATFORM_ADMIN_BOOTSTRAP_EMAILS` 僅供 Vercel `Preview` 環境的 `staging` 分支使用。Google 回呼必須同時確認已驗證 Email、Google provider、精確 Email 允許清單及既有 Auth 綁定沒有衝突，才可建立或恢復 `PLATFORM_ADMIN`；每次實際變更都會寫入 `PLATFORM_ADMIN_BOOTSTRAPPED` 稽核紀錄。

- 不可將此變數套用至 Production。
- 不可使用萬用字元、網域或部分字串授權。
- 完成指定帳號首次登入及管理後台驗收後，移除 Staging 允許清單並重新部署。
