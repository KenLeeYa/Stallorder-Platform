# WebPRNT overnight recovery — 2026-10-21

Status: PR #367 release candidate, not yet deployed. On 2026-10-21 the owner explicitly waived pre-release physical verification for this urgent release because printing failures disrupt store operations. Physical MCP31LB/iPad recovery remains **not run**, not passed. This exception applies only to this release; automated, security, Staging and Production identity/readback gates remain required.

## Incident evidence and limits

- User reports MCP31LB + iPad, recurrent failures after a closed day, and restarting the Star app does not resolve them. Supplied photographs show a current Staff connection warning and a Print Center green “module ready” banner above an **offline** printer. This is not proof of successful Bluetooth transport.
- Read-only Primary investigation matched the affected printer. At investigation time, its last heartbeat was 2026-10-19 20:03:29 Asia/Taipei. The 14-day snapshot initially had 184 jobs. A new job at 2026-10-21 14:40:37 was subsequently observed `PENDING`, with no `printing_at`: 183 succeeded, 1 failed (`PRINT_RESULT_UNKNOWN`, October 8), 1 pending. No jobs were retried, printed, cancelled or edited during investigation.
- The generic rejection also exists in older history, but the old client did not retain Star protocol codes for those errors. Preflight/test errors do not necessarily create or claim a job. Absence of a new failed job does **not** mean absence of a device failure.
- Exact on-device cause (Bluetooth link, Star target selection, printer hardware status, native bridge or device contention) cannot be reconstructed from that generic text. Do not present this software fix as confirmed physical recovery.

## Confirmed software defects

1. `classifyStarWebPrntResponse` returned `PRINT_REJECTED` before checking paper, cover, cutter and offline bits. Codes `1100` (offline) and `2001` (busy) were not distinguished. Regression first failed with `PRINT_REJECTED` instead of `PAPER_END` / `OFFLINE`.
2. The bundled Star 1.2.0 SDK's iOS `webPRNTSupportMessageHandler` transport uses one callback slot per URL and does not implement its own timeout on that native branch. A lost callback left the client promise unsettled. A deterministic missing-callback test first remained `pending` rather than timing out.
3. Print Center used SDK readiness for its green banner, and a separate interval refreshed WebPRNT liveness without probing the device. A selected printer could keep an apparently valid lease despite connection failure.

## Implemented contract

- Inspect specific hardware status before generic rejection; preserve only bounded numeric `traderCode`, 16-hex `traderStatus` and numeric `httpStatus`. Never retain response text, receipt bytes, customer data or credentials. UI and claimed-job failures include these diagnostic codes, with six-language actionable messages.
- Serialize print, non-printing probe and drawer commands in the same window before entering the native SDK. Add an application watchdog. After an ambiguous timeout, quarantine further sends until the original callback arrives or the page is reloaded. Late success cannot change the timed-out promise into success; no automatic raw-data replay or drawer repeat.
- Probe on `pageshow` / visible resume and existing intervals; skip hidden-page probes. WebPRNT heartbeat follows successful device response only, including manual takeover/test paths. The green banner requires a successfully selected WebPRNT device, not just a loaded script. Failed probes clear active selection; the existing 90-second backend lease expires naturally. A failure from one tablet does not revoke another tablet's lease.
- Add `WEBPRNT_DIAGNOSTIC` to the existing authenticated, CSRF-protected print-queue API. It verifies enabled WebPRNT printer membership in the actor's tenant/stall, accepts an allowlist of codes and phases, and rate-limits to 6 reports per actor/stall/minute. Audit action: `PRINT_QUEUE_WEBPRNT_DIAGNOSTIC`, outcome `FAILURE`, metadata source `CLIENT_REPORTED`. This is a diagnostic report, **not** server-verified hardware status.
- Client reporting is best effort, identical reports are deduplicated for one minute, and uploads are bounded to five seconds. Audit failure cannot make a print successful or cause a retry. No schema migration, provider setting, order/payment transition, CloudPRNT transport, printer firmware or Bluetooth setting changed.

## Automated verification

- Focused Vitest: 7 files / 74 tests passed, including actual bundled SDK status decoding and native callback-slot recovery, allowlisted diagnostics, tenant/CSRF/rate-limit boundaries, existing queue and ticket regressions.
- `npx playwright test --config playwright.webprnt.config.ts --repeat-each=2`: 16/16 passed (Chromium + WebKit). Real React Print Center/Staff components and bundled Star SDK; local HTTP harness, synthetic API and native-device responses, no database or physical printer. Covers auto/manual liveness, failed resume, recovery, busy test-print reporting, missing callback and page reload without replay.
- Initial manual-mode Chromium QA failed because the harness attempted to click behind an acknowledged-success modal. The fixture now closes it via its actual acknowledgement button; recovery assertions remain intact. No application focus trap was removed.
- Hosted CI `39567727485` exposed four native component failures: the default desktop browser configuration omitted the Star user agent that existed only in the dedicated configuration. The busy-rejection case reproduced locally under the default configuration. The spec now declares its native-bridge user agent and blocked service-worker fixture itself; CI also runs the dedicated Chromium/WebKit configuration. The default full suite still discovers all four cases; no assertion, failure or timeout is suppressed.
- After the CI correction: default-configuration native regression 4/4, repeated dedicated Chromium/WebKit regression 16/16, workflow/dependency contracts 53/53, typecheck and diff checks passed. These are local fixture results; a fresh hosted run remains required.
- Typecheck and local production-mode build passed. Targeted lint and diff whitespace checks form the closing gate. Browser harness is functional component QA, not authenticated full-application, CSP, real Bluetooth or paper-output proof.
- Existing authenticated local printer-indicator E2E was updated for diagnostics and timeout quarantine but not executed here (no application/DB test service started). Full authenticated Staging flow remains required before release.

## Production / device acceptance still required

Current Production readback: `app.qidaigo.com/api/version` still reports `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`. Login, Staff login and body-free connectivity returned 200. These are availability checks only, not authenticated printing proof. No remote writes or deployment occurred.

Use the protected Staging → Production process and exact candidate identity. The owner's 2026-10-21 emergency instruction supersedes the pre-release physical-test prerequisite for this candidate only. After deployment, physical acceptance remains outstanding: foreground return after extended idle, correct Star target, Bluetooth transport, paper/cover/busy cases, one explicit test ticket, and one authorized queue job producing exactly one ticket. Preserve existing pending jobs until actual device response is confirmed. Do not auto-retry `PRINT_RESULT_UNKNOWN` or claim that a WebKit fixture proves iPad recovery. Report deployment success separately from unverified paper output.

After deployment, query tenant-scoped audit events for `PRINT_QUEUE_WEBPRNT_DIAGNOSTIC` with event time, phase, code and protocol fields; do not expose customer payloads. Prior generic errors cannot be retroactively decoded.

## Official references

- [StarWebPrintTrader responses and status helpers](https://www.star-m.jp/products/s_print/sdk/webprnt/manual/en/_StarWebPrintTrader-js.htm)
- [Star webPRNT use precautions](https://www.star-m.jp/products/s_print/sdk/webprnt/manual/en/_infoToUse.htm): backgrounding during printing can prevent a response; repeated sends are unsafe. Model/iOS-specific troubleshooting examples are not evidence that this incident has the same hardware cause.

## Isolation and cleanup

Changes live in `codex/webprnt-overnight-20261021`, based on the verified Production source. Other dirty worktrees, LINE work and shared local services were not edited or restarted. Browser fixtures bind an ephemeral loopback port and close their server/browser after each run. No Docker, Supabase or persistent app server was started.
