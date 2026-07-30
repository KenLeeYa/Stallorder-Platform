# 未來現場 Edge Gateway

本文件只記錄未來選項，本階段不部署。

完整雲端或 DNS/CDN 中斷時，新顧客可能無法載入 QR。若未來需要在現場區域網路
持續提供多裝置 QR、POS、KDS 與列印，可評估受管理的 mini PC／gateway：

```text
現場 Wi-Fi
-> Local HTTPS
-> 簽章菜單快照與本機訂單 API
-> 多裝置 POS/KDS queue
-> 雲端恢復後的冪等同步
```

進入實作前必須解決：

- Local TLS、DNS/mDNS、captive portal 與瀏覽器信任。
- 裝置實體安全、磁碟加密、權限、遠端撤銷與安全更新。
- 路由器、電源、UPS、印表機與現場支援。
- 多 gateway leader election、衝突、時鐘與 promotion epoch。
- 本機備份、資料保存、顧客資料最小化與遺失通報。
- 回雲端的 idempotency、價格／售罄重驗、付款與現金 reconciliation。

`LOCAL_EDGE_GATEWAY_ENABLED` 必須維持關閉。不得把一般 PWA、Service Worker
或 IndexedDB 描述成共享現場 gateway；目前離線 POS 只支援已核准單一 Leader
裝置的本機持續作業。
