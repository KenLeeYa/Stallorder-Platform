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
5. 依語系分批呼叫已設定供應器（Azure Translator、OpenAI Direct 或 Vercel AI Gateway）。
6. Azure 回應與 LLM Structured Outputs 都先經 Zod 驗證，再驗證鍵值完整、無重複、無未知項目。
7. 全部批次成功後，才在單一 Prisma transaction 內合併翻譯。
8. 寫入前重新讀取翻譯；若翻譯期間有人補上人工內容，保留人工內容。
9. 清除公開菜單快取並寫入稽核紀錄。

任何模型、網路或驗證錯誤都會在資料庫寫入前終止，不會留下部分翻譯。

## 傳送資料

會傳送：

- 商品名稱
- 商品說明
- 分類或群組名稱作為 LLM 供應器的翻譯情境；Azure Translator 不傳送此欄位
- 註記群組與選項名稱
- 目標語系及缺漏欄位指示

不會傳送：

- 組織、攤位或資料庫 ID
- 價格與付款資料
- 訂單或顧客資料
- 顧客備註與取餐碼
- Session、CSRF、QR、Turnstile token
- 資料庫連線或其他 Secret

介面執行前會明確顯示實際供應器與模型。Azure 模式固定連線至 Microsoft 官方
`api.cognitive.microsofttranslator.com` endpoint，不允許環境變數改寫網址；完整字串先查詢
應用程式 glossary，命中時不送上游。OpenAI Direct 請求設定 `store: false`；
Vercel AI Gateway 請求設定每次 `zeroDataRetention: true`，Gateway 不留存提示詞或輸出，
並只路由至具 ZDR 協議的下游供應器。預設 Gateway 模型為
`google/gemini-3-flash`。每筆請求會將混合中文中的連續拉丁字詞視為商家刻意保留字；寫入前會
驗證這些字詞的 NFKC 相容形式、順序與邊界，並以 NFKC 後的數字序列驗證數字沒有新增、
遺漏或調換。
單位及一般語意正確性由模型指令、五語金標菜單與原生語者 QA 驗證；此程式防線不宣稱能
完整理解所有語言的單位或辨識純拉丁來源中的每一個品牌。

## 環境變數

建議的 Azure Translator 設定：

```dotenv
CATALOG_TRANSLATION_ENABLED="true"
AI_TRANSLATION_PROVIDER="azure-translator"
AZURE_TRANSLATOR_KEY="<server-only-secret>"
AZURE_TRANSLATOR_REGION=""
```

- `AI_TRANSLATION_PROVIDER` 未設定時預設為 `openai`；可設為 `azure-translator` 或
  `vercel-ai-gateway`。
- `AZURE_TRANSLATOR_KEY` 只能存在於伺服器環境，不得使用 `NEXT_PUBLIC_` 前綴。
- 單一服務 global Translator resource 的 `AZURE_TRANSLATOR_REGION` 留空；regional 或
  Azure AI multi-service resource 才填入 Azure Portal 的 Region。
- Azure resource 是否為 F0 由 Azure 設定決定，應在 Portal 驗證 pricing tier、用量與警示；
  應用程式不會把 resource 宣稱為免費方案。
- `CATALOG_TRANSLATION_ENABLED` 是緊急停用開關；預設為 `false`。若此變數未設定或為空，
  才向下相容讀取舊的 `OPENAI_TRANSLATION_ENABLED`。
- 建議先只在 Preview 設定並完成 benchmark 與人工 QA，再決定是否進入 Staging；不得直接套用 Production。

OpenAI Direct 設定：

```dotenv
CATALOG_TRANSLATION_ENABLED="true"
AI_TRANSLATION_PROVIDER="openai"
OPENAI_API_KEY="<server-only-secret>"
OPENAI_TRANSLATION_MODEL="gpt-5.6-luna"
```

- `OPENAI_API_KEY` 只能存在於伺服器環境，不得使用 `NEXT_PUBLIC_` 前綴。
- `OPENAI_TRANSLATION_MODEL` 可覆寫模型，但只接受安全的模型名稱格式。
- 預設使用適合高流量工作負載且支援 Structured Outputs 的 `gpt-5.6-luna`，
  並將 reasoning effort 設為 `none`，降低此明確翻譯工作的等待時間。
- 應在 OpenAI 專案設定獨立的支出與速率上限。

Vercel AI Gateway 設定：

```dotenv
CATALOG_TRANSLATION_ENABLED="true"
AI_TRANSLATION_PROVIDER="vercel-ai-gateway"
AI_GATEWAY_TRANSLATION_MODEL="google/gemini-3-flash"
```

- Vercel build 可讀取平台注入的 `VERCEL_OIDC_TOKEN`；Vercel Function 則在每個請求的
  `x-vercel-oidc-token` header 提供短效憑證。本功能使用官方 `@vercel/oidc`
  `getVercelOidcToken()` 於 request context 動態取得，不快取也不傳到瀏覽器。
- 本機開發可用 `vercel env pull` 取得短效 `VERCEL_OIDC_TOKEN`，或設定持久的
  `AI_GATEWAY_API_KEY`。優先序為 `AI_GATEWAY_API_KEY`、當次 request OIDC、
  本機 `VERCEL_OIDC_TOKEN`。
- `vercel env pull` 取得的 OIDC token 只有 12 小時效期，不得另存成 Vercel
  runtime 環境變數；到期時應重新執行 `vercel env pull`。
- 取用 OIDC 時保留六分鐘到期緩衝，避免最長五分鐘的翻譯工作在執行途中失效。
- Gateway 每次請求強制 ZDR（Vercel Pro 或 Enterprise）；若所選模型沒有可用的
  ZDR 下游供應器，請求會失敗且不寫入翻譯。
- OIDC 只處理認證；Gateway team/project 仍須有 credits，且不得超過 budget。
  失敗稽核會以不含上游訊息或憑證的固定分類記錄：認證、餘額／預算、速率限制、
  權限／驗證、模型／路由或一般上游失敗。
- Preview 驗證需包含五個目標語系的實際寫回抽查。升級到 Staging 或 Production 前，
  必須另做目前模型可用性檢查、金標菜單評測與原生語者審核；Preview 成功不等同 Production 核准。

未完成設定時，介面的 AI 翻譯按鈕會停用，API 也會以 `503` 拒絕。

## 50 × 5 benchmark

固定評測集包含 50 筆台灣菜單資料與 `en`、`ja`、`ko`、`vi`、`th` 五個目標語系，共
250 個人工審核目標；涵蓋文化菜名、品牌 token、數字／單位、過敏原、飲食宣稱、促銷與
提示注入外觀字串。

只驗證 fixture 與請求數，不呼叫上游：

```powershell
npm run catalog:translation:benchmark -- --dry-run
```

以目前環境設定的 provider 實際執行，並輸出不含 Secret 的人工審核檔：

```powershell
npm run catalog:translation:benchmark -- --output artifacts/catalog-translation-benchmark-preview.json
```

程式防線會先驗證所有名稱／說明的品牌 token 與數字序列；任一項失敗時不產生 PASS 報告。
通過只代表 hard guards 通過，報告仍標記 `PENDING_NATIVE_REVIEW`，不得視為語意品質或
Production 核准。

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

1. 將 `CATALOG_TRANSLATION_ENABLED` 設為 `false`。
2. 重新部署。

既有人工與 AI 翻譯都會保留，商家仍可手動編輯已啟用語系。

## 官方依據

- [OpenAI Responses API text generation](https://developers.openai.com/api/docs/guides/text)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [Azure Translator REST quickstart](https://learn.microsoft.com/azure/ai-services/translator/text-translation/quickstart/rest-api)
- [Azure Translator service limits](https://learn.microsoft.com/azure/ai-services/translator/service-limits)
- [Vercel AI Gateway OIDC](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc)
- [Vercel AI Gateway Zero Data Retention](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr)
- [Vercel AI Gateway Budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)
- [Vercel AI Gateway models endpoint](https://ai-gateway.vercel.sh/v1/models)
