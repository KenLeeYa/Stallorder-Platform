# 2026-10-02 整合安全契約與發布狀態

## 通知已讀資料的 Primary-only 回填

`20261001120000_personal_notification_inbox.sql` 只建立 schema，不在 DR-first Apply 寫入 replicated 資料。原申請通知的 `read_at` 不刪除；Primary schema 完成後、對外啟用新通知中心前，必須核對真正 Primary project／連線，再執行 `supabase/fixtures/primary_notification_read_receipts_backfill.sql`。fixture 核對目前 backend 為 PRIMARY／ACTIVE_WRITER／writes_enabled，複製非空歷史已讀時間，以 ON CONFLICT DO NOTHING 保留既有 receipt；交易內確認無缺漏，提交後讀回 `missing_legacy_read_receipts=0` 並封存收據。不能在 DR 執行，不能把 static fixture 測試視為已完成遠端回填；由 Primary 寫入後依 publication 同步 DR，另驗 DR 讀回。

## 本輪範圍與證據邊界

使用者要求將本機候選與安全架構工作區尚未完成項目整合，完成驗證後發布。安全來源為 `c31a5d9b379086b04360430aa71564b083a99292` 與 `de2096b1333906ae513742b304b60a3583551d02`；整合工作樹為 `integrated-production-20261002`。此文件記錄整合契約，不是發布收據。歷史 local PASS、Preview 實機證據不自動轉為本次 Staging／Production PASS；最終 commit、tree、Plan、部署及實際流程回讀由本輪發布收據補齊。

## LINE 現行架構優先規則

本對話明確採平台會員與單一攤點通平台官方帳號。2026-09-30 安全 Prompt 的「各商家自有 OA 為現況」假設已由此次整合 supersede；原始輸入與歷史測試不可改寫為另一種架構已通過。

- 新平台通知固定 `PLATFORM_OA`，每環境唯一 sender registry；商家只決定已授權訂單範圍，不選 sender／任意收件人／平台秘密。`src/server/line-platform/notification-binding.ts` 以 environment 唯一索引與 provider／destination／channel 條件維護 binding。
- Webhook 依平台 raw-body 簽章、environment、provider、destination 與 active integration 核對；worker 發送前重新檢查資格。對應 `notification-webhook.ts`、`notification-worker.ts`、`messaging.ts`。平台 sender 不表示跨店讀取或核銷權限。
- 既有 LEGACY 通知保持獨立 owner／帳本；平台流程不借用各店 OA Token，也不能讓 legacy worker 雙發平台 owner 的工作。不自動搬移歷史通知或合併身份。
- OA 通知、MINI 入口與各店 LINE Pay 能力各自控制；整體平台緊急停用不等同局部開關。實際 runtime 有 `LINE_PLATFORM_ENABLED` 及 notifications／pickup／pay 子開關；需按原能力檢驗開關組合與既有在途訂單，不能宣稱只有三個完全無相依旗標。
- 各店 Pay 收款資格、credential snapshot／version、merchant reference／channel 維持獨立；平台不代收代付。`src/server/payment-providers/line-platform-payment-config.ts` 目前僅 Sandbox，明確拒絕 Production。未完成正式金流資格、LIVE transport 與驗證前不得移除該保護或聲稱正式 LINE Pay 啟用。

## T71–T80 整合版驗收

仍為待執行／待補證據，不能因閱讀來源改標 PASS：

| 控制 | 本輪契約 |
|---|---|
| T71 | 平台 webhook 錯簽章／destination／environment／停用拒絕；不同租戶資料不可被事件混用。 |
| T72 | 商家／支援帳號不可讀平台 OA 秘密或借用另一店 Pay；秘密版本輪替與舊版本拒絕。 |
| T73 | 平台管理者遠端 webhook 設定、test／apply／readback 權限、稽核、失敗復原與 SSRF。 |
| T74 | 通知／MINI／Pay 功能組合、整體與子旗標撤銷；不破壞在途支付及已要求核銷訂單。 |
| T75 | 平台 worker 延遲、額度、封鎖、退訂、重試、撤權不跨店、不雙發、不重做帳務。 |
| T76 | identity 按 provider／channel 邊界，不因 email／電話或表面 ID 自動合併；sender 資格與歷史 owner 可追溯。 |
| T77 | 平台 OA rollout／回退有明確授權與環境 binding；不回退到任意商家 OA 發同一事件。 |
| T78 | 各店 Pay return／Confirm／退款／對帳不能操作另一店，UNKNOWN 與重送不重扣。 |
| T79 | 顧客卡／QR 轉發、跨店、重掃及並行核銷負案；付款／交付／列印／配送狀態獨立。 |
| T80 | 第三方 POS／承運 scope、重派版本及舊裝置 ePOD 附件拒絕。 |

## 尚缺實作與外部設定

repo 尚缺完整 archive dispatcher／checkpoint／告警、全主體匯出 mapping、五類 deletion adapter、due／incident 通知，以及所有高風險入口 step-up。已有部分 order／profile 投影、四類刪除 executor 不能宣稱全帳戶權利履行。

E01–E22 的法律角色／告知／DPA、保留期限會計核定、MFA 身份／恢復、獨立 archive 與金鑰、真 LINE／Pay channel 與配額、硬體／承運資格及 provider／restore 真實驗證仍須對應證據。E19 以平台 OA registry 及各店 Pay 清冊核定，不再要求本次新平台通知使用各店 OA。未完成的合規能力維持 `COMPLIANCE_ENABLED=false`、`COMPLIANCE_DELETION_DRY_RUN=true`，不得發布草案為已核定法律文件。

五項 security migration 與 DR replication scope 改動需固定候選先驗 DR 相容 schema、再 Primary expand；環境本地 step-up grant 不複寫。不沿用舊 Plan，不以關閉開關替代 migration 安全性驗證。

## 使用者本輪明確延後外部事項

2026-10-02 使用者確認目前沒有法人／核定隱私告知與保存政策、MFA、獨立 archive，指示先跳過。此為延後設定與啟用，不等於已具資格或免除保護：本輪不建立相關外部帳號、發布法律草案、啟用權利收件／敏感治理／刪除／archive dispatcher；保留清單，狀態為 DEFERRED_BY_USER。既有登入、下單、履約與安全加固仍須驗證，不受此延後豁免。

`complianceEnabled()` 只接受環境值精確 `true`；缺少值或 false 時，新 privacy／step-up API 第一個 gate 返回 404，商家 privacy 頁在登入／workspace DB 查詢前 notFound，merchant layout 不渲染入口，order tracker 直接返回既有 tracker。這是來源查核結果，仍需本次實際 runtime 負案驗證。

關閉功能不能省略 schema 相容性：Prisma Order 新增兩個 erasure 欄位，既有完整 Order 查詢亦會選取欄位，因此必須在使用該 client 的應用上線前完成對應相容 migration，或提供經獨立驗證的不同發布切片；不可只設 OFF 後直接略過 migration。
