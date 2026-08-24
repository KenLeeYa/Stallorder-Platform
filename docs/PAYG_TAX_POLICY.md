# PAYG Tax Policy

StallOrder 不從國家、幣別或地址推測稅率。平台管理員只能依已核准的財務／稅務決策建立新的 PlanVersion。

支援契約值：

- `INCLUSIVE`：從含稅總額抽出稅額；若 cap basis 是 `TAX_INCLUSIVE_TOTAL`，最終每攤位總額不超過合約 cap。
- `EXCLUSIVE`：由稅前小計另加稅；cap basis 必須明示 `PRE_TAX_USAGE` 或核准的含稅語意。
- `EXEMPT`、`OUT_OF_SCOPE`：稅額為 0，但 jurisdiction 仍須明確。
- `UNCONFIGURED`：永遠禁止遷移與關帳。

稅率用 basis points 儲存；捨入模式與範圍寫入封存契約及 Invoice snapshot。晚到完整退款依原 Invoice 的稅務 snapshot 計算，不使用目前版本。實際稅務值必須由商家會計／稅務顧問核准。
