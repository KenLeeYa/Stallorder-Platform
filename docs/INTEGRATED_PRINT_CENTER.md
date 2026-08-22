# StallOrder integrated print center

## Supported connection paths

| Path | Daily device | Printer network required | Intended use |
| --- | --- | --- | --- |
| MCP31LB Bluetooth WebPRNT | iPad with the official Star WebPRNT Browser | No | Counter and kitchen printing when the printer cannot join a network |
| MCP31LB CloudPRNT PoC | Printer polls StallOrder over Ethernet | Yes | Unattended single-printer physical acceptance only |
| System print | Safari or another browser invokes the operating-system print dialog | Depends on the selected printer | Manual fallback and non-Star printers |

iPad Safari does not implement Web Bluetooth and therefore cannot send StarPRNT bytes directly to MCP31LB over Bluetooth. StallOrder detects Safari and offers a one-tap `webprnt://` handoff to the official Star WebPRNT Browser. The same StallOrder URL opens after the handoff, but Safari and Star WebPRNT Browser may not share sign-in cookies. The first use can therefore require one sign-in inside Star WebPRNT Browser; after that, daily printing should stay in that browser while its StallOrder session remains valid. A native StallOrder app is not required, but the Star browser is required for the Bluetooth transport.

The current CloudPRNT path remains a deliberately bounded one-printer PoC. It is not a general multi-printer credential service. See [MCP31LB_CLOUDPRNT_POC.md](./MCP31LB_CLOUDPRNT_POC.md) before enabling it.

Official compatibility references:

- [Star webPRNT interface compatibility](https://star-m.jp/products/s_print/sdk/webprnt/manual/en/_interfaceTable.htm)
- [Star webPRNT Browser launch architecture](https://star-m.jp/products/s_print/sdk/webprnt/manual/en/_sampleProgram.htm)
- [Web Bluetooth implementation status](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md)

## MCP31LB Bluetooth setup on iPad

1. Install a 57.5 mm roll and select the StallOrder **58 mm** paper profile. Star and POS software conventionally name this profile 58 mm; entering 57 mm is rejected to prevent a misleading layout.
2. Pair MCP31LB in iPad Bluetooth settings.
3. In StallOrder, open **店員模式 → 列印中心**, add a printer, choose **MCP31LB / Bluetooth WebPRNT / 58 mm**, and enable it.
4. Tap **接管列印**. When StallOrder is open in Safari, tap **使用 Star Browser 開啟**. The same URL opens through the official Star browser. Sign in there once if its cookie store does not already contain a valid StallOrder session.
5. Tap **測試列印**. This emits a synthetic device-health ticket and does not create an order, customer record or print-job database row.
6. Confirm Traditional Chinese, margins, partial cut and paper feed. Then enable automatic rules one at a time.

Only one iPad should take over a Bluetooth printer at a time. A different device can explicitly take over when the previous device is unavailable. A printer heartbeat makes ownership visible and prevents two devices from silently printing the same queue.

## Integrated rules

Each enabled rule selects one printer and defines:

- Document: kitchen ticket or customer receipt.
- Trigger: order confirmed or payment completed.
- Order scope: counter, QR, online menu and other supported sources/origins.
- Fulfilment: dine-in, takeaway pickup or delivery.
- Product routing: all items, selected categories, selected product groups, or their union.
- Split mode: one ticket, category tickets, product tickets or one item per ticket.
- Output: 1–5 copies, compact/medium/large font, aggregate identical items, and item sorting.

A stall can keep at most 50 rules. This bounds the number of jobs produced by one order event while still covering common kitchen, drink, packing and receipt stations. CloudPRNT rules are always automatic because that transport is polled by the printer and has no interactive claim step; a rule that needs operator confirmation should use Bluetooth WebPRNT or system print instead.

Printer connection changes, browser claims, and rule creation, editing and deletion use serializable database transactions so simultaneous operators cannot race past the 50-rule cap, transfer a claim between transports, or commit an invalid CloudPRNT policy. Changing or disabling a printer is blocked while it has an in-flight job, and changing to CloudPRNT is blocked until every enabled rule assigned to that printer is automatic. CloudPRNT rechecks the current connection and active automatic rule in the same transaction that claims a pending job.

Examples:

- **Kitchen hot line**: confirmation trigger, kitchen ticket, hot-food categories, split by category, one compact copy.
- **Drink station**: confirmation trigger, drink group, one compact copy.
- **Customer receipt**: payment trigger, full order, one copy. Receipts cannot be category- or item-split because totals must remain coherent.
- **Delivery packing**: confirmation trigger, delivery only, full-order ticket with customer delivery details where supplied.

When no integrated rule exists, StallOrder preserves the legacy single-printer queue. Once rules exist, only matching rules create print jobs. OFFLINE_POS orders do not create a second server job because their local queue is already responsible for printing.

## Ticket and receipt layout

The 58 mm profile uses 32 columns and omits empty sections and decorative blank rows. The ticket contains only operational information: stall, order number, fulfilment and promised time, items and modifiers, important notes, quantity summary and print time. A customer receipt additionally contains item prices, discount, total and payment information.

Draft annotations such as `[A1]`–`[A4]` are never printed. Font scale is implemented with documented StarPRNT size commands; the compact setting is the paper-saving default. Every payload ends with two feed lines and one partial cut.

## Queue safety and recovery

- The first matching rule reuses the legacy root job; additional destinations become routing copies.
- A unique order/rule key prevents a repeated order-status update from creating duplicate work.
- Payload bytes are generated once and stored immutably. Retry and reprint use the exact stored bytes.
- A job is successful only after the device reports success. Paper-out, cover-open, cutter, temperature and offline statuses remain visible.
- A job left in `PRINTING` for five minutes becomes `FAILED / PRINT_RESULT_UNKNOWN` when an authenticated queue refresh runs. Reading the queue alone never mutates state. The uncertain job is not automatically retried because the physical printer may already have produced paper. An operator must inspect the printer, then choose retry or reprint.
- Manual reprints are marked on the kitchen ticket; automatic copies routed to another station are not mislabeled as reprints.
- Deleting a rule archives and disables it instead of destroying its historical job relationship. Its unclaimed pending/failed jobs are cancelled in the same transaction and the original name can be reused for a new active rule. An already printing job is preserved because the system cannot safely infer whether paper has already been produced.
- Queue actions are tenant- and printer-scoped, audited and entitlement-gated. Pro and Enterprise fallback entitlements include printer integration unless explicitly disabled.

## Physical acceptance before automatic use

- [ ] Safari displays the Star-browser handoff instead of claiming direct Bluetooth support.
- [ ] The official Star browser opens the same StallOrder URL, allows a one-time sign-in when needed, preserves that session after relaunch, and detects its bridge.
- [ ] Only the device that took over the printer can claim its jobs.
- [ ] The synthetic test ticket prints without creating an order or queue row.
- [ ] Traditional Chinese is legible and no line clips on the 57.5 mm roll.
- [ ] Compact, medium and large font settings match the selected rules.
- [ ] Partial cut succeeds with the minimum required bottom feed.
- [ ] Kitchen, drink, packing and receipt rules each receive only their selected products/orders.
- [ ] A repeated confirmation/payment event creates no duplicate rule job.
- [ ] Paper-out and cover-open show a recoverable error and preserve the job.
- [ ] An uncertain timeout never auto-prints a second copy.
- [ ] Concurrent or repeated retrieval of one CloudPRNT token returns identical bytes and produces exactly one physical ticket.
- [ ] Retry and manual reprint are distinguishable in the audit log and on paper.
- [ ] Thirty sequential orders produce the expected number of rule tickets with no missing or duplicate output.

The database migration, browser path and automated tests may merge through the `staging` source gate before this physical checklist is complete. Automatic Production printing must remain disabled until the MCP31LB/iPad checklist passes. Production deployment separately requires the verified staging tree, a fresh immutable Production Plan approval, migration validation and post-deployment smoke checks.
