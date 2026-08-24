# PAYG Late Full Refund Policy

- 關帳前完整退款：append-only refund event 使當期淨計費數下降。
- Invoice 仍可編輯且沒有付款核對或已開立稅務文件：重新關帳可安全重算。
- Invoice 已付款或已有 issued tax document：建立唯一 `billing_credit_adjustments`，於下一張可編輯 PAYG Invoice 套用。
- 部分退款不自動折抵完整 TWD 1 平台費。

折抵與原 order、completion event、refund event、Invoice 及原稅務 snapshot 連結。重複退款不重複建立，折抵不可讓新 Invoice 為負數；未能全部使用者保留 `UNAPPLIED`。若需要折讓稅務文件，必須先完成 provider／會計驗收才可啟用相關收費流程。
