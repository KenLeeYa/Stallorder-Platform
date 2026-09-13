# 2026-09-13 基線與缺口
本次使用獨立 clone Stallorder-Platform-security-compliance-20260913，分支 codex/security-privacy-compliance-20260913。起點 commit 4ab57b62965f52dceff0d83b11f6895990806e0a，tree 8c66a5584eab8817e6bb4c4d9a27636f0cac8418。原工作區未提交內容及另一個 DR 工作區保留；沒有 push、merge、dispatch、provider 設定、遠端 migration 或對外通知。完整閱讀兩份指定輸入後，依實際程式、lockfile、SQL、測試核對；輸入中的部署指示不作為遠端寫入授權。

## Primary／DR
正式 app.qidaigo.com 的 project prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP，deployment dpl_Dr4dFxgHafKBREP1t6NExuWTK51J，commit c67d0b356269b8385d766e33de8f9555a7b98109。首次及後續唯讀查核見 production-readback-latest.json。服務版本與本次原始碼起點不同；健康／登入入口 HTTP 成功不等於登入後的 QR／員工完整交易通過。

另一工作區 Stallorder-Platform-dr-probe-20260913 未修改。34737455830 最後查核 Plan 成功、approval/apply skipped。本次新 tree 與 migration 日後合併會改變發布計畫，必須重新 Plan；不得沿用舊收據。本機隔離修改不會被該工作區部署程序讀取。

2026-09-12 的已確認根因是 DR 子程序繼承 Primary VERCEL_PROJECT_ID；只寫 .vercel/project.json 無法保證 CLI 專案。基線已有明確子程序 project/team、deployment readback、Primary 前後比對及並行變更保護。較後 DR_ENTRY_PROBE_JSON_MISSING 為另一失敗階段，舊收據欠 HTTP 狀態，不能斷言仍為 TLS 或同一 project 問題。參照 incidents/2026-09-12-dr-production-outage.md、PRODUCTION_DR_AUTOMATION.md。

## H01–H10
| ID | 最新核對／處置 | 剩餘驗證 |
|---|---|---|
| H01 | authorization/RBAC/report DTO與排程控制沿用；權利請求不套用付費報表 entitlement | 真實角色報表與 hosted runtime |
| H02 | strict schema、server scope、複合 FK；新 request/export SQL 包含 organization；跨租戶拒絕整合測試 | 全入口實際 role 與 pool context |
| H03 | oauth-linking/OIDC/SQL 維持 provider subject、LINE scope與顯式連結；不按 email 自動合併 | 真實 provider/MFA 帳戶 |
| H04 | CloudPRNT hash、scope、穩定callback、lease/ACK沿用 | 實機、token輪替與斷線 |
| H05 | 原 QA 只驗 DATABASE_URL 且繼承所有 env；9個負案例先失敗，修正後12測試通過 | 所有實際恢復外部連線仍需受控 egress |
| H06 | 子程序 OS＋loopback合成設定；audit metadata 遞迴遮罩；既有CodeQL沿用 | 外部CI/錯誤平台及bundle掃描分層證據 |
| H07 | 新表expand無業務backfill；既有fence；step-up環境本地，其餘治理證據分類複寫 | 真實replication／snapshot／restore |
| H08 | 保留schema3 Plan/project/concurrent rollback修正；本次零Apply | 新tree需fresh Plan，不混入別的工作 |
| H09 | 訪客先走Canonical Circuit B，body不能指定order/org；Origin/rate/no-store | 真實代理與Edge直連驗證 |
| H10 | canonical payments/inbox/outbox/PAYG/completionIntent沿用 | 完整回歸與provider/hardware分開列示 |

新實作有：權利請求、加密內容、期限展延證據、主體範圍複本與撤銷、MFA proof、support grant、legal hold、刪除預演/部分目標executor、事故狀態機、audit原子outbox與已提交不可改寫。全部 rollout OFF。
P0門檻：實際 postgres/service_role BYPASSRLS、法律核准告知/保留、獨立封存/撤銷副本、DR及完整restore。P1：外部目標主體映射、實機與live provider。未完成項目不以文件或mock掩蓋。

Windows fresh clone CRLF 使既有函式文字替換 migration 失敗；專屬lab正規化LF後完成fresh建置。新增.gitattributes固定SQL LF，既有migration Git blob未改。後續本次migration使用single-transaction套入該lab；不宣稱遠端history/upgrade通過。
