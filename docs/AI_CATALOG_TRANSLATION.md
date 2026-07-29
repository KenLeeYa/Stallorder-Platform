# 商品與註記 AI 翻譯

## 目的

商家可在共用商品頁使用「一鍵補齊翻譯」，將已啟用商品、商品說明、註記群組與註記選項，翻譯為該組織目前啟用的 QR 語系。

此功能只補缺漏欄位，不覆蓋人工翻譯。停用語系只會從介面隱藏，既有翻譯資料仍保留。

## 語系範圍

- 繁體中文 `zh-TW` 是固定來源語系。
- 共用商品屬於組織，因此翻譯目標採用所有授權中有效攤位的啟用語系聯集。
- 單一攤位停用某語系，但另一個有效攤位仍啟用時，共用商品仍會保留該語系的編輯與翻譯功能。
- QR 預覽則只顯示所選攤位已啟用的語系。

## 後端流程

1. API 重新驗證登入、組織範圍與 `MANAGE_SHARED_PRODUCTS` 權限。
2. 驗證 CSRF、JSON Content-Type、內容大小與嚴格的 Zod 請求格式。
3. 套用操作人與組織兩個維度的 rate limit。
4. 從資料庫讀取已啟用商品與註記，建立「只補缺漏」計畫。
5. 依語系分批呼叫 OpenAI Responses API。
6. 使用 Structured Outputs 驗證欄位型態，再驗證鍵值完整、無重複、無未知項目。
7. 全部批次成功後，才在單一 Prisma transaction 內合併翻譯。
8. 寫入前重新讀取翻譯；若翻譯期間有人補上人工內容，保留人工內容。
9. 清除公開菜單快取並寫入稽核紀錄。

任何模型、網路或驗證錯誤都會在資料庫寫入前終止，不會留下部分翻譯。

## 傳送資料

會傳送：

- 商品名稱
- 商品說明
- 分類或群組名稱作為翻譯情境
- 註記群組與選項名稱
- 目標語系及缺漏欄位指示

不會傳送：

- 組織、攤位或資料庫 ID
- 價格與付款資料
- 訂單或顧客資料
- 顧客備註與取餐碼
- Session、CSRF、QR、Turnstile token
- 資料庫連線或其他 Secret

OpenAI 請求設定 `store: false`。介面執行前會明確告知商家上述內容將送至 OpenAI。

## 環境變數

```dotenv
OPENAI_TRANSLATION_ENABLED="true"
OPENAI_API_KEY="<server-only-secret>"
OPENAI_TRANSLATION_MODEL="gpt-5.6-luna"
```

- `OPENAI_API_KEY` 只能存在於伺服器環境，不得使用 `NEXT_PUBLIC_` 前綴。
- `OPENAI_TRANSLATION_ENABLED` 是緊急停用開關；預設為 `false`。
- `OPENAI_TRANSLATION_MODEL` 可覆寫模型，但只接受安全的模型名稱格式。
- 預設使用適合高流量工作負載且支援 Structured Outputs 的 `gpt-5.6-luna`，
  並將 reasoning effort 設為 `none`，降低此明確翻譯工作的等待時間。
- 建議先只在 Staging 設定並執行人工 QA，再同步至 Production。
- 應在 OpenAI 專案設定獨立的支出與速率上限。

未完成設定時，介面的 AI 翻譯按鈕會停用，API 也會以 `503` 拒絕。

## API

`POST /api/merchant/organizations/:organizationId/catalog/translate`

請求：

```json
{
  "mode": "MISSING_ONLY"
}
```

不接受覆蓋模式或額外欄位，以避免 mass assignment 與誤覆蓋人工內容。

目前單次上限為 1,000 個「實體與目標語系」組合；每批最多 50 項，最多同時執行 3 批。超過上限會拒絕，不會部分處理。

Rate limit：

- 同一操作人與組織：10 分鐘 3 次
- 同一組織：1 小時 10 次

## 稽核與監控

成功事件：

- `CATALOG_AI_TRANSLATION_COMPLETED`

失敗或阻擋事件：

- `CATALOG_AI_TRANSLATION_FAILED`
- `CATALOG_AI_TRANSLATION_RATE_LIMITED`
- `CSRF_VALIDATION_FAILED`

稽核只記錄語系數量、目標數量與完成數量，不記錄原文、譯文或 API Key。

## 回復方式

1. 將 `OPENAI_TRANSLATION_ENABLED` 設為 `false`。
2. 重新部署。

既有人工與 AI 翻譯都會保留，商家仍可手動編輯已啟用語系。

## 官方依據

- [OpenAI Responses API text generation](https://developers.openai.com/api/docs/guides/text)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
