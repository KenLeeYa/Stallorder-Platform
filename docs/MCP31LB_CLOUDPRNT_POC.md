# MCP31LB CloudPRNT 58mm PoC

## Scope

This PoC connects a Star MCP31LB to StallOrder without an iPad helper app. The iPad continues to use Safari. The Lightning cable can supply power and SteadyLAN connectivity, while the printer pulls jobs from StallOrder over Ethernet and HTTPS.

The PoC implements CloudPRNT Version HTTP only. It does not authorize a Production deployment or claim that physical 57mm output has passed.

## Locked hardware profile

- iPad 7th generation, iPadOS 18.7.9, Lightning
- Star MCP31LB with Ethernet connected
- 58mm paper guide installed
- 57.5 ± 0.5mm thermal roll
- Printer firmware 3.2 or later so `jobToken` is available
- One-time MCP31LB Web Configuration is allowed; no iPad app is needed for daily operation

## StallOrder configuration

Set two server-only environment variables in the target environment. Use different credentials in every environment and a password generated from at least 32 random bytes.

```text
CLOUDPRNT_POC_BASIC_USERNAME=<environment-specific-username>
CLOUDPRNT_POC_BASIC_PASSWORD=<environment-specific-password>
```

Register the logical printer from the StallOrder print settings first. Retrieve its `Printer.id` from the authenticated print queue response, then build the server URL:

```text
https://<staging-host>/api/cloudprnt/v1/<printer-id>
```

Do not put the username or password in the URL.

## MCP31LB one-time Web Configuration

1. Connect MCP31LB to Ethernet and open its Web Configuration page from the same network.
2. Confirm the firmware is 3.2 or later. Update it before the PoC if `jobToken` is unavailable.
3. Confirm the 58mm paper guide and Traditional Chinese character support.
4. Enable CloudPRNT.
5. Enter the Staging server URL shown above.
6. Set polling to 5 seconds for the PoC. Re-evaluate 5–10 seconds after latency and request-volume measurements.
7. Enter the environment-specific Basic Auth username and password.
8. Keep the default secure HTTPS trust and TLS settings. Do not lower TLS security to make the test pass.
9. Save, restart the printer, and confirm its first authenticated POST appears in the Staging logs.

## Implemented protocol sequence

1. MCP31LB sends an authenticated POST with `statusCode`, MAC address and current `jobToken` when present.
2. StallOrder returns the oldest assigned PENDING job as `jobReady: true`, `mediaTypes: ["text/plain"]` and a UUID `jobToken`.
3. MCP31LB sends GET with the same token. StallOrder creates one immutable `kitchen-58mm-v1` payload and changes the job to PRINTING exactly once.
4. Repeated GET requests return the same stored bytes.
5. MCP31LB prints UTF-8 plain text and performs a partial cut with the minimum required feed.
6. Only a successful DELETE confirmation changes the job to SUCCEEDED.
7. A failed DELETE changes the job to FAILED and records the decoded printer status for an explicit retry.
8. Paper-out or cover-open POST status is recorded without discarding the active token, so the same job can resume after recovery.

## Locked compact kitchen ticket

```text
越好吃一中店｜廚房製作單
外帶自取 #A023 ★預約
取餐 08/21 19:00｜下單 18:42
--------------------------------
2× 牛肉湯河粉
   加麵／肉量加倍／★不要香菜
1× 涼拌米線
   小辣
--------------------------------
備註：河粉先做，飲料稍後
共2品項／3份｜列印18:42
```

The discussion labels `[A1]` through `[D4]` are never emitted. Empty optional sections are omitted, item rows have no decorative blank lines, control characters are removed, and every output line is limited to the 32-column 58mm profile.

## Staging acceptance checklist

- [ ] POST, GET and DELETE are visible over HTTPS without redirects or Vercel access-protection interception.
- [ ] Invalid Basic Auth returns 401 and never reveals whether a printer or job exists.
- [ ] The printer reports a `jobToken` and accepts `text/plain`.
- [ ] Traditional Chinese prints without missing or garbled glyphs.
- [ ] All lines fit the 57.5 ± 0.5mm roll without clipping.
- [ ] No drafting labels or decorative blank rows appear.
- [ ] Partial cut completes with only the mechanism-required bottom feed.
- [ ] A repeated GET prints the same stored payload hash.
- [ ] A paper-out interruption resumes the same token after paper is restored.
- [ ] A cover-open interruption does not mark the job successful.
- [ ] Two concurrent GET requests increment the attempt count only once.
- [ ] A repeated DELETE is idempotent and does not create another job.
- [ ] Thirty sequential orders produce exactly thirty tickets with no missing or duplicate output.

## Gates

- Local protocol and formatter tests: required before Staging.
- Staging HTTPS protocol test: required before physical printing.
- MCP31LB physical 57mm test: required before enabling automatic printing.
- Production remains blocked until the verified Staging tree, database migration, release plan approval and post-deployment smoke checks are complete.
