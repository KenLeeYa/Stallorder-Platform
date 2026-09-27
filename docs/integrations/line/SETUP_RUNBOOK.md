# LINE v2 設定、試點與復原

2026-09-27。本頁不授權發布；候選所有新旗標預設關閉。正式主站、DR、3023人工UI都未被本輪替換。

## 先核對真實平台身份

1. OA Manager確認「攤點通平台」OA ID、顯示名、管理人、现有Bot/選單來源。不要直接用越好吃店家OA作平台sender；沒有平台OA就依EXTERNAL_SETUP_CHECKLIST辦理。
2. LINE Developers確認同一正確Provider下的Messaging、LINE Login、MINI內部developing/review/published Channel與LIFF ID。精確記錄環境，linked OA為平台OA。身分只需openid；若另用friendship API依當日官方要求配置profile，不預設Email。
3. 明確自有HTTPS Preview、/mini Endpoint、測試者及安全Session/callback origin。local自簽+假ID只能本機QA，LINE公開抓QR無法用loopback。
4. 分別保存OA access token/secret至原Vault、平台資料加密key及Pay merchant version至server secret管理。不要將值寫入文件、前端或git。

## 程式設定

.env.example提供空白欄位。LINE_PLATFORM_BINDING_JSON為strict JSON：

- environment、providerId、channelId、liffId、internalChannel、endpointUrl（HTTPS，path恰/mini）。
- oaDestination（bot/info的userId）、oaChannelId、oaAccessTokenReference、oaSecretReference（兩個Vault UUID）。
- termsVersion；addFriendUrl可選，僅line.me/lin.ee官方HTTPS。
- LINE_PLATFORM_ENVIRONMENT必須與部署及binding一致。
- Preview/Production另填LINE_PLATFORM_DATABASE_BINDING_JSON：environment及獨立核對DB目標的fingerprint。以server runtime的platformDatabaseFingerprint計算host/port/path/username，不含密碼；不可把錯目標重算後冒充驗證。
- LINE_PLATFORM_DATA_KEY：32-byte Base64。PICKUP_TOKEN_GRACE_MINUTES預設120。
- Pay callback/state secret與每商家versioned env:// reference見PAYMENT_OPERATIONS。

分離開關：LINE_PLATFORM_ENABLED（入口）、LINE_PLATFORM_NOTIFICATIONS_ENABLED（Push）、LINE_PLATFORM_PICKUP_ENABLED（新取餐能力）、LINE_PLATFORM_PAY_ENABLED（新支付）。門市另有enabled/cutover。停止新付款須只關PAY旗標，保留既有恢復；已有pickup_required單不可無交付安排就全關平台。

## Migration與本機驗證

按現有受控migration流程依序套20260927010000～070000。先用隔離clone、查身份/權限/原baseline與回復備份，不能db push或指向Production測試。各真DBtest強制loopback55722/精確DB `stallorder_line_miniapp_20260926`。

本機候選已有相容migration及合成資料。臨時QA可用scripts/start-line-platform-qa.mjs（需要本機.env.local、受限clone、.secrets測試憑證）；此腳本沒有真實Channel/Push/Pay。原3023保持獨立。测试結束停本次3024程序，不停其他工作區容器。

## Preview／雙店驗收

1. 依專案規則先Staging/Preview，capture Primary健康、deployment/alias/backend及明確復原target；單一remote writer。不要觸發DR或主站domain切換。
2. /admin/line-platform由平台管理者同步registry，讀回bot/info與配額；設定Webhook /api/webhooks/line-platform，驗empty events/簽章/destination/重送。先盤點舊Bot設定再改。
3. 只開兩個授權測試門市，保存cutover，原舊單不搬移。正確OA好友/通知同意後跑同會員雙店卡片→READY→preview→交付。
4. LINE Pay先使用各店自己的SANDBOX connection，真Request/授權/Confirm/取消/查核/退款；記每店正確收款身份。沒有正式host適配，不能開LIVE。
5. 遠端通知commit wakeup/pg_net/cron、Pay每分鐘查核cron須驗實際認證、重啟、延遲；local測試沒有證明scheduler正常。
6. 依TEST_REPORT G組實機；缺條件即BLOCKED。所有外部設定/認證分別簽收，不能以OA登入取代Pay或MINI認證。

## 選單

先 `node scripts/line-platform-rich-menu.mjs --example` 與 `node --test scripts/line-platform-rich-menu.test.mjs`，零網路。示例JSON不能發布。真實設定重新dry-run，查原Manager/API/per-user覆蓋及備份；精確plan/hash授權後才能apply/restore，詳RICH_MENU_OPERATIONS。歡迎訊息為草稿，未自動發布。

## 回復

先停新單/Pay/個別門市，不刪事件、付款、owner、已用票據或credential version。保留查核及受控交付完成在途單。通知UNKNOWN先用原key/body恢復，超窗口人工；Pay UNKNOWN不重付/盲退。回復已驗健康應用artifact，保留相容schema；讀回Primary/DR/alias/backend、login/Staff及受影響訂單實際流程，再記錄完成。不要把READY或部署成功當全流程證據。


## MINI 下單相依開關

MINI 使用既有 Circuit B 下單入口。非 development 環境須依現有受控 rollout 啟用 `DUAL_ORDER_INTAKE_ENABLED`，並具備原本的 QR session、反濫用驗證、攤位營業／可預約時段與庫存設定；LINE 平台旗標不取代這些檢查。本機測試使用原 development 入口，不修改正式旗標。既有核心未實作「每一取餐時段固定名額上限」；時段合法性與商品库存需分開驗證，不宣稱時段容量預占已存在。
