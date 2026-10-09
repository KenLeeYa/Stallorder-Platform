# 攤點通跨裝置改版：實作計畫審閱入口

設計核准：使用者於 2026-09-30 回覆「核准」，採用方案 B；隨後選擇「逐批子代理實作＋獨立審查」，核准下列九項任務開始實作。本輪工作樹為 `C:/Users/KY/.codex/worktrees/responsive-cross-device/Stallorder-Platform`，分支 `codex/responsive-cross-device-20260930`。

## 核准後的交付順序

| 批次 | 計畫／成果 | 驗收重點 |
|---|---|---|
| A | [顧客、Staff／POS、KDS](2026-09-30-responsive-order-workflows.md)；6 個可獨立驗收的任務 | 第一個完整切片是顧客手機下单、店員平板接單、KDS製作、同單追蹤及交付；不是只換樣式 |
| B | [Merchant、Admin 與整合驗收](2026-09-30-responsive-management-verification.md)；3 個任務 | 管理功能完整可到達、表格重排、權限負例、八尺寸及效能證據 |

兩份計畫共用目前已核准的[八份設計文件](../../ux-responsive/current-state.md)，依 A1→A6→B1→B3 執行。B1 與 B2 可獨立審查，但不並行啟動資料庫 writer。每一批先驗現況，既有案例已通過就保留，不為湊改動重寫。

## 固定邊界

- 原始碼基準：`codex/line-platform-oa-v2-20260927`，`fb3974155a4cec2288168711acdc6306d8350fd2`。執行時若 HEAD／dirty 狀態已變，先重算差異與相關測試；不覆蓋他人修改。
- 保留 3023 的工作樹、服務與手測資料。它的 HEAD／dirty 與候選不同；先前 30 張截圖只能作 UX 參考，不能充當候選測試通過。
- 新候選預定使用獨立本機服務 3026，以及獨立 Supabase project `stallorder-responsive-20260930`；詳細埠、設定、資料保護與啟停規則見 A1。**目前尚未啟動或配置。**
- 先前偏好保留：平板／桌機三欄預設與全圖示工具列；手機主要功能＋所有功能；平台 QR 在取餐碼右側；份數旁總額、緊湊實收與醒目找零。窄直向加「展開明細」，不默默改掉三欄。
- 不增加 UI framework、業務 API、付款流程或訂單版本 schema。不變更 Production／DR／Staging／LINE 控制台；無真實訊息、收退款或硬體開櫃。
- 測試只使用本輪隔離資料。既有測試有廣泛清理 demo session／rate-limit 的行為，絕不能接到 55722 或保留環境。

## 每批交付方式

每個任務有明確檔案、介面、失敗案例、驗證指令及獨立 commit。先處理可重現缺陷，再做整合驗收；付款／訂單成功、列印佇列成功與實機出單分開記錄。任務內一般步驟不再請示。

本機完成後提供單一測試入口、角色入口、同單證據與 before/after。若人工 QA 入口仍需保留，記錄為既有「供我測試」要求的服務保留例外；停止額外 runner／mock，保留資料。實機 Safari、Android、螢幕閱讀器、印表機若不可取得，一律列待驗，不充當自動化 PASS。

## 計畫自審結果

| 需求 | 任務覆蓋 |
|---|---|
| Phase 00 候選基準、環境、量測 | A1；B3 做同方法 after |
| Phase 01–02 共用契約、tokens、dialog、角色介面 | A2、A4、B1、B2 |
| Phase 03 顧客客製／購物車／結帳／追蹤 | A3、A6 |
| Phase 04 平板三欄、手機、POS、列印狀態 | A4、A5、A6 |
| Phase 05 管理設定、報表與 Admin | B1、B2 |
| Phase 06 一致性、斷線、撤權、QR／LINE 邊界 | A5、A6、B1 |
| Phase 07 八寬度、觸控、鍵盤、AA、效能 | 每任務相關回歸＋B3 |
| Phase 08 分批回退、文件、分環境狀態 | 每任務提交＋B3 |

已對照真實 `ExperienceDialog`、`startLiveResource`、KDS、POS、Merchant editor、Playwright 與 LINE runner 介面。修正了「沿用測試就能直接執行」的假設：舊 suite 有固定埠與資料清理，LINE suite 更固定 3024／指定 DB；本次用獨立目標，所需合成 LINE 覆蓋另外接入本輪 fixture，不解除舊 runner 的安全檢查。未宣稱已建環境或已跑交易。

## 執行方式選擇

推薦 **逐批子代理實作＋獨立審查**：9 個任務涉及共用 Dialog、KDS 狀態與收款 pending 保護，逐批檢查較能防止 UI 變動破壞原流程。由主控安排順序、唯一測試 writer 與最終整合。另一選擇是主控依序實作，最後再做一次全分支獨立審查，成本較低。

狀態：`DESIGN_APPROVED`；`IMPLEMENTATION_PLAN_APPROVED_EXECUTING`；`LOCAL_VERIFIED=false`；未發布。
