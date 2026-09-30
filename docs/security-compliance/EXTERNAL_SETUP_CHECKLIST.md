# 外部設定、法律與會計集中清單
本表所有項目均未由本次遠端變更。owner 為責任角色，尚須公司指派人員。不得將 secret 貼到聊天或 Git。先完成 E01/E02 核定，再依功能分批處理；不把低風險修正與所有商用啟用綁成一次上線。

資源基線：Primary Vercel project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`、team `team_MMfsiG94K9Zy3e6w7Ccc9xY4`、hostname `app.qidaigo.com`；DR `dr.qidaigo.com` 由另一工作區維護。DB/Auth/Storage 實際 project ref 必須從受保護設定及 provider readback 配對，不能只由 hostname 或本機 .vercel 推定。本次未取得可證明 Production backend 的 deployment metadata。

| ID／用途與控制 | 指定環境／資源、現況及精確待辦 | 權限／費用／owner | 驗證、影響與復原／狀態 |
|---|---|---|---|
| E01 法律角色 T25–30/68–69 | StallOrder 法人與三家測試商家：補統編、窗口、實際行業、controller/processor、主管機關；律師核 LEGAL_APPLICABILITY、NOTICE、DPA 草案及尚未生效修法。 | 法人代表＋法務；法律審閱可能費用 | 簽核版本與有效日後才新增不可改寫 policy row；不可直接發布草案。撤回新版本以後續版本處理。BLOCKED |
| E02 保留與計費 T30/55–56 | 會計確認 vouchers/books、年度決算起算、5/10年例外、每攤月份/含稅/退款/PlanVersion；法務核 CUSTOMER_CONTACT 用途終了期限及legal hold。 | 會計＋法務；專業費用待報價 | 以合成跨月/未結項樣本簽核；不回寫歷史帳單。新retention version先dry-run，錯誤停executor保留舊證據。BLOCKED |
| E03 雲端及DB身份 T06/67 | 上述Vercel與對應Primary/DR Supabase：清冊實際DB角色、owner/BYPASSRLS、GRANT、SECURITY DEFINER、pooler與JWT；建立非bypass runtime候選，先隔離Staging全套回歸。 | 雲端owner/DBA；方案費用待確認 | 本機postgres/service_role確有BYPASSRLS，不直接REVOKE正式權限。比對角色/tenant負案/查詢延遲；回復已驗證連線角色，不能放寬已修正授權。BLOCKED |
| E04 OAuth/MFA T17–22 | Google/LINE/Apple各環境client與callback；既有Supabase Auth對應subject、browser session、aal2/JWKS、TOTP/WebAuthn及recovery。設定COMPLIANCE_MFA_ISSUER精確等於Supabase URL/auth/v1、AUDIENCE=authenticated。 | 身分系統owner；MFA方案/SMS可能費用 | 用真實測試身分完成enroll/challenge/應用session綁定、撤權/恢復/last owner；目前只驗證簽章與合成grant，不能以設定值就宣稱整合完成。功能OFF為復原。BLOCKED |
| E05 欄位金鑰 T27/35/44 | 獨立環境secret store/KMS：32-byte base64 key；先保留legacy FIELD_KEY讀舊文，固定SUBJECT_KEY，FIELD_KEYS map＋ACTIVE_KEY_ID只切新寫入。 | KMS管理與解密權分離；KMS費待報價 | rotation讀舊/寫新/receipt穩定已本機驗證；實際分批重加密及key使用量稽核後才退役舊key。不能刪掉唯一可讀舊資料key。BLOCKED |
| E06 獨立稽核 T32–35/46 | 與DB管理權分離的object archive/WORM＋Ed25519/KMS signer、獨立checkpoint；接AuditArchive adapter並實作可靠worker、回讀與lag告警。 | 資安/維運分權；儲存、WORM、請求、保留成本待估 | 現在只有durable outbox與簽章驗證，尚無archive dispatcher/告警投遞。驗完整批次、獨立刪改拒絕、斷線重送；停worker不刪outbox，不聲稱WORM已啟用。BLOCKED |
| E07 全部刪除目標 T27/29/31/44 | 每個顧客/帳戶對應Storage、cache、search、analytics、vault/通知/外部vendor；建立具名清冊、合法期限、revoke/delete API及receipt格式。 | 各data owner；API/儲存費待盤點 | 本次只執行單筆已核對terminal order聯絡、列印、待送授權與複本。ACCOUNT全量匯出/刪除、外部5類仍需mapping與adapter實作；不以缺adapter當作無資料。保持DRY_RUN=true。BLOCKED |
| E08 Storage/Realtime/Edge T10–11/37/43 | 對應環境Supabase buckets、object policy、Realtime publication/broadcast/presence、Edge gateway、generated Vercel URL。 | 雲端/應用維運；方案費視用量 | 實際anon/auth/runtime分別list/get/upsert/delete、撤權重連、direct-origin負案；變更前匯出設定hash，回復已核定policy。SQL/單元測試不等於hosted驗證。BLOCKED |
| E09 支付商 T47–52/55–56 | 每個provider各自sandbox merchant、raw-body簽章、幣別/金額、通知/查單、退款累計與對帳；平台費與商家收款分開。 | 商家/PSP核准；資格、交易及退款費待核 | 實測扣款timeout後查單、重送/亂序、退款對象與帳本；未知規格adapter保持disabled。輪替憑證採雙讀回讀；不重扣或刪ledger復原。BLOCKED |
| E10 外送/通知/發票 T25/47/52/69 | LINE OA/Login scope、foodpanda/Uber Eats/物流、mail、電子發票各自商用資格、DPA、環境key/callback、deliverability。 | 每個商家/provider owner；各別費用 | 不互用簽章規格；先sandbox、verified inbox/outbox/readback、抑制/撤回佇列，再具名pilot。停dispatcher/credential，保存待查效果。BLOCKED |
| E11 完整恢復 T31/63 | 備份/Storage bytes/Auth設定/PITR、獨立較新的刪除與撤銷feed；指定隔離restore project及egress/worker停用。 | DBA＋資安；備份/PITR/演練費用待核 | 本機已還原DB且撤銷session/device/step-up；files、Auth服務設定、較新feed及雲端RPO/RTO尚未證明。未通過不得開流量；保留備份與原writer。BLOCKED |
| E12 DR協調 T64–67 | DR工作區owner、main/staging exact tree、5個新expand migrations、135-table分類、publication/DDL/sequence/lag、環境本地step-up表。 | 唯一release writer；既有環境費用另核 | 先DR相容schema再Primary，fresh Plan/來源hash/健康/回復artifact；舊Plan 34737455830不適用新tree。每步readback；不修改另一工作區當前部署。BLOCKED |
| E13 DNS/WAF/egress T36–40/45 | Cloudflare zone/access/DNSSEC/CAA/TLS、Vercel direct URL、可信proxy headers、來源IP/NAT配額、外連allowlist。 | 網域/網路owner；方案費可能 | 偽造forwarded header、IPv6/metadata/redirect/DNS變動、同NAT真實負载。應用不依賴WAF代替授權；rollback保留origin防護。BLOCKED |
| E14 裝置 T54/57–62 | Star/iPad/webPRNT/CloudPRNT/Bluetooth/門市LAN、printer/device credentials與開櫃資格。 | 商家＋硬體owner；實機/憑證/門市時間成本 | 真機claim/lease/ACK丟失、rotation、離線重送/換店/lock screen、獨立no-sale權限。停該device、保留pending交易，不以列印失敗改付款。BLOCKED |
| E15 事件與告警 T28/34/46/68–69 | 具名事故負責人、客服/主管機關窗口、契約時限、補報與書面送達；due/backlog巡檢排程與告警通道。 | 法務/資安/客服；on-call/通知費用 | 本次事件狀態機/期限已實作；自動提醒與archive告警dispatcher尚待接通。演練真實收件證据前不稱已通報；保留知悉時間及原始版本。BLOCKED |
| E16 供應商跨境/授權 T13–14/35/70 | VENDOR_AND_TRANSFER_REGISTER補契約、資料地區、次受託、刪除退出；SBOM14項原生影像套件LGPL/授權告知由法務檢查。 | 採購＋法務；審查/合約費用 | 不是14個漏洞；npm audit本次0。確認散布方式/notice與退出實測，不擅換依賴解除。BLOCKED |
| E17 CI與正式驗證 T35/67 | GitHub protected staging/main、現有CI/CodeQL；本次只固定CI/CodeQL action SHA，不修改DR/release workflow。 | repo security admin；Actions額度可能 | 實際remote CI、secret/error平台log抽查、review/branch保護與全新Preview驗證；本次沒有push/dispatch。BLOCKED |
| E18 既有AI／原生App T62/70 | 檔案顯示既有catalog translation AI及PWA/offline；無本次新增native shell或自動工具agent。 | 產品＋資安＋法務；API/商店費按實際存在能力 | AI輸入限商品/語系、無任意工具調用；hosted租戶/供應商保留/惡意資料要實測。若另開nativeApp再核商店政策，現在不臆造上架完成。CONDITIONAL/BLOCKED |

補充實作工作清單：E06 dispatcher/monitor、E07全主體mapping/額外adapter、E15通知/提醒通道，以及現有付款/收款資訊等高風險入口全面套用新step-up，均不能僅靠填env完成。必須先確認既有身分provider可綁定應用session後，依共享呼叫鏈逐項實作及回歸；目前新step-up只涵蓋本次privacy/support治理API，不宣稱全系統MFA已落地。

## 2026-09-30 v2.0 同步（本機，未發布）

所有 owner 尚待指定；本輪不設定外部資源、不新增費用。

| ID | 用途／控制與精確待辦 | 環境／權限與費用 | 驗證／復原 | 狀態 |
|---|---|---|---|---|
| E19 | T71–77：逐商家 OA/Login/MINI App 清冊、sender 綁定、收件資格、秘密版本、webhook 精確允許 URL；平台 OA 預設關閉 | 指定測試 channel；商家與平台管理者最小權限；資格／配額成本待核 | raw body、跨店拒絕、遠端 test/apply/readback、八組開關、撤權重試；失敗停發並保留站內查單，不雙發 | BLOCKED |
| E20 | T72/T78：各店 Pay sandbox merchant、環境、Confirm／查詢／退款授權 | 各商家測試商戶；正式資格與費率待核；不得用另一店憑證 | 跨店、逾時後查單、退款併發及對帳；停止新 attempt，不刪舊交易 | BLOCKED |
| E21 | T76/T80：更新告知／同意、DPA、資料區域、ePOD 留存與分享；核現行 PlanVersion、稅務及退款保存 | 法務／會計／業務 owner；專業核對費用待確認 | 官方法源／版本／生效日、簽約與實際欄位對照；未核定不擴大資料用途／更改費率 | NEEDS_LEGAL_ACCOUNTING_REVIEW |
| E22 | T79/T80：指定門市裝置、第三方 POS／承運者 scope、任務版本及授權測試資料 | 隔離測試環境／實機及商用合作權限；硬體及渠道費用待核 | 取餐併發、重派後舊裝置與附件拒絕；撤銷測試綁定，保留必要交易證據 | BLOCKED |
