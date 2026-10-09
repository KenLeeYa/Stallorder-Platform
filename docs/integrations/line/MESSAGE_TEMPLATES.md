# 平台 OA 訂單卡片

`src/server/line-platform/messaging-template.ts` 只提供四個平台交易事件，商家不能提供任意模板或訊息。原始店名、訂單號及文字經 Zod 長度/型別驗證；JSON 序列化不拼接 markup。

| 卡片 | 標題與用途 |
|---|---|
| ORDER_RECEIPT_AVAILABLE | 訂單已成立；顯示付款當時狀態，不將現金未付或 LINE Pay UNKNOWN 描述為已付款 |
| ORDER_READY | 餐點已完成，請取餐；再次確認整單 READY，提供 QR 與門市資訊 |
| ORDER_PICKED_UP | 已完成取餐；只來自真正核銷事件，顯示完成時間 |
| ORDER_CANCELLED | 訂單已取消；停止過時 READY，不會為了湊齊訊息補發 |

成立與 READY 的外帶卡片附自有 HTTPS PNG QR，來源僅允許 runtime endpoint 同 origin。媒體服務提供獨立 opaque capability，不在 URL 透露訂單 PII。QR 首次可建立，過期／撤銷／使用後不自行復活；已存在快照重試不重新產生 QR。若需要 QR 卻不可用，停止事件並顯示營運原因。

卡片包含攤點通、門市/分店名稱、訂單號、取餐號碼、金額、付款文字、下單時間、地址及預估/預約時間。時間沿用原訂單權威順序：商家承諾、顧客請求、原預約時間，最後才採用預估完成時間。電話僅允許電話字元後生成 `tel:`；沒有安全電話則導到該訂單的聯絡資訊。Mini App detail 按鈕固定 `https://miniapp.line.me/{serverLiffId}/orders/{immutableOrderId}`，回到會員授權頁查最新狀態。

每张卡片提示「本卡為通知當時快照；最新狀態與 QR 效期請查看訂單」。新狀態不改已接受的 bubble，補發重試也不更換 body。QR 重新發行由履約核心撤銷舊 capability，LINE 快取圖片不會恢復舊碼效力。

Flex 使用單一 bubble、vertical box、原生 text/image/button，文字自動換行；altText 最多 400 字元。實機 LINE 排版、公開 HTTPS 圖片與雙裝置掃碼仍須另外驗證，程式產生 JSON 與本機 QR 解碼不等於 LINE 裝置驗收。
