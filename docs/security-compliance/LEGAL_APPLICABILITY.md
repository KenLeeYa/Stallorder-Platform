# 法規適用性
查核日2026-09-13；法律文件DRAFT，未聲稱律師/會計簽核或認證。AnySearch官方法規擷取失敗後，才以官方網站fallback查核。

| 官方來源 | 適用性 | 工程前提／待核對 |
|---|---|---|
| [個資法現行與沿革](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021)／[目前生效條文](https://law.moj.gov.tw/LawClass/LawOldVer.aspx?pcode=I0050021) | REQUIRED；新修法 NEEDS_LEGAL_REVIEW | 114-11-11部分修法仍註記施行日未定，不把新增20-1、修正12或刪除27當成已生效。公司實際角色/主責機關/施行公告需確認。 |
| 個資法13條 | REQUIRED | 查詢閱覽複本15日，必要延長最多15日；更正停止刪除30日，必要延長最多30日；從收件計，身分核對不暫停。延長須理由與書面通知證據。必要複製費及期限計算由法務核定。 |
| [數位產業安全維護辦法](https://law.moda.gov.tw/LawContent.aspx?id=GL000090) | CONDITIONAL | 先核對附表與實際活動。第8條72小時以知悉起算且須危害正常營運或大量當事人權益；未知維持ASSESSING。第16條5年限必要安全證據。 |
| 同辦法18、19條 | CONDITIONAL | 資本額1,000萬或5,000筆個資等門檻與過渡規則逐項核對，未達不免除全部義務。委託/供應商監督另列。需真實證照、人數及契約。 |
| [商業會計法38條](https://law.moea.gov.tw/LawContent.aspx?id=FL011300) | CONDITIONAL | 憑證5年，帳簿/財務報表10年，自年度決算後起算；永久/未結事項例外。必要帳務留存不代表永久保存電話/地址；會計確認分類與年度。 |
| [消保法43條](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0170001) | CONDITIONAL | 消費申訴15日妥適處理；不套用個資展延。B2B SaaS與B2C商家角色、申訴窗口分開核對。 |
| [通訊交易例外準則](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0170012) | CONDITIONAL | 易腐敗/短保存期例外須符合條件且事先告知，不稱所有餐飲/食品/一般零售均無七日解除權；瑕疵與退款個案另處理。 |
| [電子支付機構管理條例](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0380237) | NEEDS_LEGAL_REVIEW | 不經手/保管款項、商家直收為設計前提；代收、儲值、跨商家結算、錢包須重評。 |
| [資通安全管理法](https://law.moda.gov.tw/LawContent.aspx?id=FL088622) | CONDITIONAL | SaaS不當然納管；核對法定對象、指定及客戶契約。 |
| [ASVS 5.0.0](https://owasp.github.io/www-project-application-security-verification-standard/) | REQUIRED 工程基準 | 不虛構控制編號，不宣稱認證。 |
| [NIST CSF2.0](https://www.nist.gov/cyberframework) | CONDITIONAL 治理參考 | Govern/Identify/Protect/Detect/Respond/Recover分工需組織核定。 |
| [PCI DSS](https://www.pcisecuritystandards.org/standards/pci-dss/) | CONDITIONAL 契約/收單 | 外接付款不代表當然免責；依資料範圍及收單要求核對SAQ。 |

義務、契約、安全利益與同意不是同一法律基礎。新增敏感資料、AI用途、跨境地區、代收或契約變更必須重評。外部核對統一見EXTERNAL_SETUP_CHECKLIST.md。
