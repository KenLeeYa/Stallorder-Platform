# Dependency and license matrix

No library installed in batch1. Published npm tarball SHA512 integrity was verified before in-memory inspection; only package.json/LICENSE retained, not executable extraction or install hooks. Keep selected package license notices when consumers are installed; preserve core and library notices together. Data/site attribution is not a license for commercial designer/service code.

| Package | Version | Exact published license path | Runtime impact / hooks | Status |
| --- | --- | --- | --- | --- |
| @shopify/flash-list | 2.3.2 | package/LICENSE.md; MIT | `{}`; prepare/prepublish recorded in artifact manifest, none executed | ARTIFACT_INSPECTED_NOT_INSTALLED; full future lock audit required |
| react-hook-form | 7.89.0 | package/LICENSE; MIT | `{}`; prepare/prepublish recorded in artifact manifest, none executed | ARTIFACT_INSPECTED_NOT_INSTALLED; full future lock audit required |
| @tanstack/react-query | 5.104.0 | package/LICENSE; MIT | `{"@tanstack/query-core": "5.104.0"}`; prepare/prepublish recorded in artifact manifest, none executed | ARTIFACT_INSPECTED_NOT_INSTALLED; full future lock audit required |
| @tanstack/react-table | 8.21.3 | package/LICENSE; MIT | `{"@tanstack/table-core": "8.21.3"}`; prepare/prepublish recorded in artifact manifest, none executed | ARTIFACT_INSPECTED_NOT_INSTALLED; full future lock audit required |
| @tanstack/query-core | 5.104.0 | package/LICENSE; MIT | `{}`; prepare/prepublish recorded in artifact manifest, none executed | ARTIFACT_INSPECTED_NOT_INSTALLED; full future lock audit required |
| @tanstack/table-core | 8.21.3 | package/LICENSE; MIT | `{}`; prepare/prepublish recorded in artifact manifest, none executed | ARTIFACT_INSPECTED_NOT_INSTALLED; full future lock audit required |

For npm registry dependency installs, reviewed source `prepare: husky` in RHF7.89.0 is not an instruction to Git-install or run package development scripts. FlashList prepublish/build/fixture/e2e scripts are development tooling, not permitted startup commands. Query/Table core exact artifacts were reviewed too. GitHub Advisory API returned0 matching records for the four selected packages and two exact cores; this bounded lookup does not prove a future Expo/Babel/resolved dependency tree safe. Current Mobile clone's old UUID advisory remains an explicit forwardport/audit gate.

Pinning evidence: `batch-1/package-artifact-review.json` gives each tarball URL, SHA256, exact integrity status and license paths; `candidate-manifest.json` records source commit/tag, peers and maintenance/TCO boundaries. Full repo dependency/advisory/license scan is Phase14/actual consumer gate, NOT_RUN in this batch.

## Batch 2 selected installation

The four TanStack rows above describe their historical Batch 1 state. Batch 2 installs only `@tanstack/react-query@5.104.0` and `@tanstack/react-table@8.21.3`, with exact query-core 5.104.0 and table-core 8.21.3. Current React/ReactDOM 19.2.4 satisfy the inspected exact peers. `npm install --save-exact --ignore-scripts` was used after exact official tarball SHA/integrity, APIs, peer and typed-consumer checks; other candidate libraries were not installed.

Retained MIT notices: [React Query](licenses/tanstack-react-query-5.104.0.LICENSE), [Query Core](licenses/tanstack-query-core-5.104.0.LICENSE), [React Table](licenses/tanstack-react-table-8.21.3.LICENSE), [Table Core](licenses/tanstack-table-core-8.21.3.LICENSE). The exact package/license hashes and consumers are recorded in `batch-2/selected-api-gate.json`. AnySearch extraction failed first; only official pinned npm artifacts were used in the documented fallback.

Actual resolved `npm audit --json` receipt is `batch-2/install-audit.json`: 20 vulnerabilities (3 moderate, 16 high, 1 critical) in the complete tree. No automatic fix or Next upgrade was performed here. That overall audit is not a claim that these four selected packages introduce all 20 findings, nor release approval. Next remains 16.3.4 for paired measurement; the separate security owner and combined later gate must handle the version/advisory boundary.

## Finite security patch installation — 2026-10-01

| Package | Exact version | License | Actual notice origin | Notice SHA256 |
| --- | --- | --- | --- | --- |
| eslint-config-next | 16.3.6 | MIT | Supplemental exact upstream v16.3.6 notice; tarball has no bundled notice | ee765244e2d59f5234d474f62e0766fa0c8b99af967fdd4c0cb8dcb0c76ea224 |
| minimatch | 3.1.5 | ISC | Bundled package/LICENSE | 4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b |
| next | 16.3.6 | MIT | Bundled package/license.md | ee765244e2d59f5234d474f62e0766fa0c8b99af967fdd4c0cb8dcb0c76ea224 |
| brace-expansion | 1.1.21 | MIT | Bundled package/LICENSE | 68f12f6e2c33688699249c01d8f9623c534da20aa71989c57b061b7bc1676d14 |
| brace-expansion | 5.0.12 | MIT | Bundled package/LICENSE | 9c63a23124d68cd30cd316a94a1a0bca34f032786df6df69fc4b5f136bac8d2e |
| minimatch | 10.2.5 | BlueOak-1.0.0 | Bundled package/LICENSE.md | 2c7c5d22ed5a8ee968c64757710979afcd77438c48b4a265b94e615babd8a901 |
| undici | 7.29.1 | MIT | Bundled package/LICENSE | a6db8096b2707bc0102d256917d4d33f298ba36d8c3f25de067a2b5bb379db27 |

Seven exact official tarballs match the contract SHA512 and actual installed bytes. Retained notices are in licenses/<name>-<version>.LICENSE. eslint-config-next16.3.6 metadata declares MIT but its reviewed official tgz contains no LICENSE; the retained file is a supplemental unmodified1079-byte notice from https://raw.githubusercontent.com/vercel/next.js/v16.3.6/license.md, equal byte-for-byte to next16.3.6's bundled notice. This exact version/tgz integrity/source URL/hash exception is root ruling22, never a generic missing-license waiver. Registry metadata has no gitHead for this package; no stronger commit mapping is invented. Next/config package version, official registry integrity and same-repository tag notice supply the recorded binding. Original missing-notice failure and AnySearch extract_failed are retained. No notice was inserted into node_modules, no install hooks ran (npm --ignore-scripts). Existing reviewed Prisma generation remains only the ordinary explicit build requirement.

Parent-scoped resolution and actual caller tests: scripts/awesome-optimization/security-patch/README.md. Exact artifact/API/peer/engine/hooks receipts: security-patch/{artifact-review,installed-artifact-proof,supplemental-license-proof}.json. One full audit includes dev dependencies: exit0,0 findings, lock8a512f94a5a43ecf119f501d84c2d55bf3d913e94a06d84ad3d4ca4221767144. This local scan is not Production exposure proof or release approval.
