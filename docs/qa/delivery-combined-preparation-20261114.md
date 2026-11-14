# Delivery release preparation: native source and terminal Edge evidence

The product remains frozen at `0d2b27144fcf589bb887e669c09e82158e3de7a2`, tree `e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0`. These controls prepare a combined release; they do not authorize or execute a Production mutation.

## Native database postimage

The existing [owned PostgreSQL 17.6 rehearsal](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/43558854329), job `132337778577`, completed successfully at control `847a62180d16b2882e7299539e57d7c8d47e5933`. It ran 82 tests, compared the materialized postimage with the actual migration result, exercised transactional Apply, repeat refusal, interrupted settlement and recovery, verified zero owned orders/sessions, and stopped its isolated project. Raw log SHA256: `ad41ce3e860f2c9c9da9c24c121651dd193470b5373d5cf7f0f592b576bd675f`. Independent hosted review receipt SHA256: `48f39d454ed78b4d105e01bc2f0f2e52f5cb0027199464817572423ecc915f81`.

Seven bounded public source chunks reconstruct the exact 50,772-byte `scripts/ci/delivery-native-postimage-source.json`, SHA256 `13e5a47022c7baf2a7ce7d73c564282c009d900656a124ead5def48a02fab5de`. The file contains five post-migration definitions/ACL/configuration and the new migration record, whose actual columns are `name`, `statements` and `version`. It contains no captured baseline rows, OIDs, customer data or credentials. A path-specific LF rule preserves its qualified bytes on Windows. Migration SHA256 is `adf00cba767ae8aac8f057a8003e40e67be04558d09bc0f0ca8774648db88bb2`.

The materializer requires a separately authenticated native baseline and pinned source digest. It preserves the principal, all 146 original history records and four existing OIDs. Only the new helper OID is a placeholder for transactional Apply comparison. Actual post-read state is still required for recovery. The source-template and hosted export reviews found no unresolved issue; source review receipt SHA256: `4ff00b4301cc600fc03937d99c70d225f2dfdb430be18742d7de52ba54cf6cfd`.

## Completed five-Edge rehearsal admission

Existing phase loaders intentionally consume earlier jobs in the same in-progress workflow. `delivery-edge-rehearsal-admission.mjs` adds a separate read-only consumer for the completed-success original run. It authenticates the original control commit/tree, reviewed source pins, first-run receipt, encrypted snapshot and eight terminal jobs. It verifies ordered mutation intents and all five replay/restore operations, decodes both complete usage receipts, checks owned cleanup and rate-expiry evidence, and binds the final receipt to its original job and readback times. Source and log retrieval is followed by unchanged run/job readback and a second six-hour freshness check.

The protected caller must independently trust and pin the original reviewed source. Current main is not substituted for the original commit, and terminal status is never rewritten to in-progress. Evidence explicitly keeps product qualification, Production recovery, mutation and release authorization false. Actual App compatibility and fresh provider state remain separate.

Before first dispatch, install and verify the final consumers and recovery controls. Workflow `408525851` permits only run number 1 and attempt 1; a failed or deleted run consumes that opportunity. Do not rename/reset the workflow or weaken this guard. Keep main/staging fixed until the original rehearsal and any required restore have settled, because the existing restore entry binds the original control through current main. Once settled, a future reviewed control can consume the original successful evidence through this immutable bridge, within its original six-hour lifetime.

## Live gaps

The renewed protected [Primary capture](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/43558987708), job `132338201861`, failed with `DELIVERY_EXECUTOR_AUTH_REJECTED` at control `71b4e0b45380d3ae55b81e83a0b155d307762216`. Five-Edge archive was skipped and no Primary mutation occurred. The owner subsequently confirmed the supplied value is the current raw password for the Primary project. Environment/connection diagnosis remains open; no automatic auth retry or credential reset was made.

Actual complete Primary capture, native mutating executor/settlement, the first paired Edge replay/restore, old-App compatibility, protected combined Plan/Apply and live affected-flow acceptance remain incomplete. The new terminal consumer has local regression evidence only until a real successful original rehearsal exists. Existing public standard runners and existing Preview resources are reused; no new paid service, key, billing configuration or resource is introduced.

## Installation checks

The updated full control suite passes 1,087/1,087 with no skips, including 34 terminal-admission and 17 template cases. Scoped lint, 31 production workflow-contract tests, both changed workflow YAML parses, and production guardrails pass. Independent terminal review verified the actual `runPairedStage` producer shape and read order, six additional rejection cases, and fixed-error redaction. Its initial diagnostic-leak finding was reproduced with a failing regression, then resolved; final receipt SHA256 is `b58ee4ec74326a85c5d957d795390c4618caa972150ba25ab56db94948df1af4`, with no unresolved findings. Incremental exact-template/LF-rule review receipt SHA256 is `28526e520ae4fc6f02df376aac5a7342ec59e8c13066391f0b4d8659b1273f4b`. These checks do not substitute for hosted candidate validation or live release gates.
