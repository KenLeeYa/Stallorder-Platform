# 台灣 LINE MINI App 申請條件查核（2026-09-28）

查核範圍：官方公開文件；使用 AnySearch 搜尋及擷取，未操作 LINE Console、勾選條款、建立 Channel、變更 Provider 或送出認證申請。工作樹基準為 `d7d67c7`。以下是政策與產品資格查核，不代表任何特定帳號已獲准或審核通過。

## 結論

**依目前台灣官方產品頁，不必先成為 Certified Provider 才能開始建立／開發 MINI App。** 台灣頁「自行開發說明」STEP 1 表示台灣已全面開放開發、無需事前提案審查，開發者可直接進入 Developers Console 建立 LINE MINI App Channel；基本功能亦可按規範發布為 Unverified MINI。STEP 2 才是 Certified Provider 申請，STEP 3 是 Verified MINI 發布審查。因此不應把「台灣 Verified MINI 送審須 CP」擴大成「連 Developing Channel 都必須先 CP」。[台灣官方 MINI App 產品頁](https://tw.linebiz.com/service/other-solutions/line-mini-app/#self2025)

**但官方頁面存在文字不同步。** MINI App Policy 的 Permitted Customers 段仍寫台灣／泰國建立 Channel 前須取得公司核准，並保留核准聯絡方式準備中的敘述。這與台灣產品頁目前的開放流程不同；本次未取得 LINE 對這段落的書面澄清，不能宣稱條款已被正式撤回。實際 Console 的帳號限制、條款聲明仍須依真實主體及權限處理；若 Console 阻擋，向 LINE 詢問具體原因，不能據此猜成缺 CP。[MINI App Policy](https://terms2.line.me/LINE_MINI_App?lang=en)

| 項目 | 官方目前說明 | 本次判定 |
|---|---|---|
| 建立 MINI App Channel、Developing 測試 | 台灣官方 STEP 1 可直接開發；建立主 Channel 會同時產生 Developing、Review、Published 三個 internal channels | 不是另申請一個「Developing 專用資格」；不可宣稱 CP 一律為建立前置條件 |
| Unverified MINI | 建立 MINI Channel 後屬未認證 MINI；台灣頁允許按規範直接發布基本功能 | 是 MINI App，仍有功能及政策限制，不等於 Verified MINI |
| Verified MINI | 台灣／泰國僅 Certified Provider 下的 MINI Channel 可申請 verification review | CP 是送審前置條件；CP 通過也不代表 MINI 自動通過 |
| 一般 LINE Login + LIFF | LIFF App 加在 LINE Login Channel，與 MINI App Channel 結構不同 | 可用於一般 LIFF／登入技術驗證，不能冒充 MINI Channel 或 Verified MINI 驗收 |

依據：[Console internal channels 說明](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/#basic-structure-of-a-line-mini-app-channel)、[Unverified 與 Verified 差異](https://developers.line.biz/en/docs/line-mini-app/discover/introduction/#verified-unverified-mini-app)、[台灣／泰國 verification review 門檻](https://developers.line.biz/en/docs/line-mini-app/submit/submission-guide/)。

## Developing 與普通 LIFF 的界線

MINI Channel 建立時會產生三個 internal channels，各有自己的 Channel ID、LIFF ID、Endpoint URL 與用途。Developing 僅供已接受權限的測試者；Review 供 LINE 審查；Published 面向使用者。一般 LINE Login Channel 的 LIFF App 不會因採用相同 HTML 或 LIFF SDK，就取得這組 MINI 管理／發布流程。官方雖建議新 LIFF 以 MINI App 建立，也不能把品牌未來整合的建議當成「既有 LIFF 已等同 MINI」的證據。[LINE Developers Console Guide](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/)

因此，一般 LIFF 可作技術測試路徑，但報告應標記為「LINE Login／LIFF 測試」。若專案要求 MINI Developing、Review 或 Published 的真實證據，必須使用對應 MINI Channel 與 LIFF ID。Verified 的標示、搜尋等進階入口、專屬 Service Messages 等能力則須按各自資格驗證；平台 OA 的 Messaging API 通知不能作為取得 MINI Service Message 資格的證明。[MINI 的功能與認證差異](https://developers.line.biz/en/docs/line-mini-app/discover/introduction/#verified-mini-app)、[台灣 MINI 常見問題](https://tw.linebiz.com/service/other-solutions/line-mini-app/)

## Certified Provider 官方入口與準備資料

官方入口是 [OAV 的 Provider 申請分頁](https://twoav.line.biz/application?tab=provider)，由台灣 MINI 官方產品頁直接連出。完整流程可參考 [2026-07-29 CP 申請說明](https://tw.linebiz.com/column/line-ads-cp-application-oav-202607/) 及 [2026-07 官方教學](https://tw.linebiz.com/e-learning/certified-provider-application-oav-202607/)。本次只查公開說明，沒有進入 OAV 登入或提交資料。

申請前應備妥：

1. **法定主體證明及 Provider 名稱。** 依機構類型準備公司／商業登記或相應核准設立文件。Provider、OA 認證主體、隱私權政策主體應對應完整法定名稱；單純品牌、簡稱不能取代。品牌／服務可依官方命名規範加註，並備佐證。
2. **同一 Provider 下已完成認證的 OA。** 新建官方帳號不等於已完成官方帳號認證；OA 認證與 CP 認證是不同步驟。
3. **公開且可持續瀏覽的中文隱私權政策。** 與官網的政策網址一致，明列同一法定主體，符合台灣個資規範。
4. **申請人身份／代表權證明。** 符合條件的同網域公務信箱驗證，或名片、在職等身份證明；代申請依實際身份提供授權文件。LINE 合作夥伴代辦另填夥伴名稱、申請人及聯絡資料。

以上資料依 [台灣官方 CP 申請說明](https://tw.linebiz.com/column/line-ads-cp-application-oav-202607/) 整理。最終欄位及補件以 OAV 當次流程與審核團隊為準，不臆測核准結果或時程。該頁亦提供 [審核諮詢入口](https://twoav.line.biz/inquiry/form/)。

## 建立 MINI Channel 本身的資料

官方建立流程包含 Provider、服務地區（Taiwan）、Channel 名稱／描述、通知信箱、適用條款與代表公司同意條款的權限聲明；服務公司所在地須與服務地區一致。隱私權政策建立欄位會依 CP 資格不同，非 CP 可於建立後編輯。不可為繞過限制而填寫不實地區或代表權。[Getting started：Create a LINE MINI App Channel](https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/#create-line-mini-app-channel)

Channel 建立後不能移到另一 Provider；跨 Provider 的 LINE 使用者識別也不同。這是建立前確認主體的重要原因，並非授權本次研究去改名或搬移。[Channel／Provider linkage](https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/#channel-and-provider-linkage)

## 對本次攤點通狀態的適用及未確認事項

- 協調任務提供的現況：平台 OA「攤點通」`@028sijlm` 已建立；Provider `2005461563`（StallOrder）已有管理員；MINI 建立頁可選 Taiwan，Create 尚因條款未勾而停用，尚未提交。**這些為上游提供的狀態，本研究沒有自行讀取 Console 驗證。**
- 看見 Taiwan 或 Create 按鈕，不證明 CP、OA 認證或 MINI 審查已完成；反之，CP 尚未確認也不足以宣稱 Developing 必然不可建立。當前官方台灣流程支持直接開始開發，但政策舊句仍須記錄。
- Provider「StallOrder」是否對應法定名稱、OA 是否已認證、隱私權政策主體是否一致、現有管理員是否有代表公司接受條款的授權，均未由本研究確認。這些會影響 CP／正式送審準備，不可替使用者作不實聲明。
- 無法由本次六分鐘公開查核確定 Console 在最終 Create 時是否另有帳號特定限制；也未確認 OAV 登入後最新全部欄位、處理時間或攤點通適用結果。

## 查核方法

先讀取全域 `anysearch/SKILL.md` 與 `runtime.conf`，使用其指定 Node.js CLI；確認 README 指向 `anysearch-ai/anysearch-skill` v3.0.1，閱讀 CLI 來源中的 `https://api.anysearch.com/mcp` 呼叫與參數處理，未讀取／輸出 `.env` 或金鑰。該本機 JS SHA-256 為 `04A501664FF07B898A1712B9CDD1FE73CEE446FC830677D774FCA55C9841DF77`；本次未取得獨立上游簽章／checksum，故不宣稱已完成原始碼逐位元供應鏈驗證。搜尋先查領域能力，再搜尋官方頁並擷取全文；本文件僅引用 LINE 官方主來源，未使用第三方說法填補資格結論，也未啟用替代瀏覽工具。
