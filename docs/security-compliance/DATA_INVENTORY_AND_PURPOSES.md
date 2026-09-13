# 資料與用途清冊
版本2026-09-13；以schema/migration為實際欄位依據。本表不自動核准保留期限。

| 資料／位置 | 主體、目的及接收者 | 最小化／保留前提 |
|---|---|---|
| profiles/auth identities/sessions | 商家員工登入、安全；provider/本人/具權限管理者 | hash token，無client metadata升權；撤銷即時重查 |
| memberships/organizations/stalls | 租戶門市授權、履約 | server scope/RBAC；BYPASSRLS仍為殘餘 |
| orders/contact/address/items | 顧客下單履約，必要通知與列印 | 訪客最小DTO、角色分欄；用途終了移除contact，財務另存 |
| payments/refunds/invoices/PAYG | 商家收款/會計/平台費、PSP | 不收PAN/CVV；版本ledger/reversal；年度決算5/10年分類待會計 |
| CRM consent/loyalty | 特定目的明確opt-in行銷與點數 | purpose/version、vault reference、撤回阻擋queue；購買不等於行銷同意 |
| print/notification jobs | 門市履約、裝置/LINE | active lease保護，結束payload按政策清除，已送內容依委託契約 |
| Storage/manifest | 商品店面圖與核准物件 | public商品圖與private物件分清；解碼/去metadata；主體映射及備份待核對 |
| offline IndexedDB/device | 核准門市斷線交易 | permit/quota、scope；換店/登出隔離且不靜默丟棄待同步交易 |
| audit/incidents | 必要安全與法律證據 | facts加密、metadata遮罩、獨立封存待配置；非永久留全部raw payload |
| privacy request/export | 本人權利請求 | scope AAD、receipt非URL、15分鐘複本且即時可撤銷；必要案件證據另定 |
| backups/DR/log/analytics | 復原、安全監控、效能 | 具名維運，單writer；還原前套用刪除/撤銷，Auth/Storage/DDL/sequence另驗 |

新表不收身分證影本、信用卡卡號/CVV、醫療或生物辨識原始資料。subject HMAC屬可連結的假名化資料，仍須按個資保護，不稱匿名。資料項目、法律基礎、接收者/地區、owner、retention版本及刪除API須依實際營運補齊。
