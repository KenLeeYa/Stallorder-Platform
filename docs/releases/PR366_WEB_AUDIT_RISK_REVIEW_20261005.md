# PR366 Web audit risk review — 2026-10-05

## Decision status

Review completed; **no new exception approved**. The prior `WEB-20261003-BRACES-USER-ACCEPTED` exception expired at 2026-10-04 16:00 UTC. Do not edit its expiry or use the prior CI pass as evidence that a new run passes. `assertRootAudit` rejects the expired exception; CI `verify` and Web Install Scope Proof run `verify-web-release-scope.mjs` and need fresh evidence.

## Exact reviewed dependency

- PR head at review: `c31c84a483993b724952d9e6c56d8c028eb31369`.
- `package-lock.json` SHA-256 of raw file bytes: `f68c4c5bd060708f5e55ee6d212de84781bf6da576a5ba6ed7ec3fc38e580626`. The policy's `JSON.stringify(parsedLock)` SHA-256 is `ff74a3a96c79d6deaabc94f36b7a3bfb45022d9d585e328ed6b3ee7d50d3f228`.
- Web root development dependency path: `eslint-config-next@16.3.6` → `@next/eslint-plugin-next@16.3.6` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. `npm ls` shows the same Web path. Native workspace paths are a separate diagnostic and are not accepted by this Web exception.
- Advisory: `GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687`, high severity, stack exhaustion for deeply nested brace patterns. GitHub Advisory Database lists `<=3.0.3` affected and no patched version as checked 2026-10-05.
- The last accepted selected Web audit recorded five high entries, corresponding to the vulnerable package and four ancestors. New audit output must be checked before any new exception decision; the lockfile and counts must be bound again if they change.

## Exposure and limits

`@next/eslint-plugin-next` invokes `fast-glob` for Next root directory globs. The checked-in `eslint.config.mjs` uses Next's core web vitals and TypeScript rules and does not set `settings.next.rootDir` from a remote request. The reviewed path is build/lint tooling, not an identified public request handler. This lowers the demonstrated application exposure but does not prove the dependency cannot be reached in another CLI/tooling path. A malicious or compromised input to a process using `braces` can exhaust its stack and terminate that process. A compromised build input or future configuration change remains a residual risk.

Removing Next's lint configuration would remove current rules and is not an acceptable workaround. Renaming/aliasing the vulnerable package to silence `npm audit` would not repair it. No official patched version is presently available. A vetted upstream patch or source-reviewed fork with a nesting-depth guard could be considered, but would require separate provenance, behavior, lint, audit and CI review; a package-name change alone is not a clean audit.

## Controls and decision needed

Keep the selected Web audit, full-repository diagnostic, lockfile binding, source/tree hashing, Next lint, Web install-scope check and build proof. Do not turn `NON_PASS` into `PASS`; record any exception as an explicit accepted-risk decision. On each new head, rerun the selected audit and check the exact five-item graph and advisory. Stop if new vulnerabilities or a changed graph appear. Continue watching the upstream advisory and replace the exception with a fixed dependency and clean audit when possible.

If the user elects to proceed before a fix, obtain an explicit new, time-limited decision for this exact Web development dependency chain, exact current lock hash, five high selected-audit entries, stack-exhaustion availability risk, and unchanged security checks. A candidate maximum is **24 hours from explicit approval**, with an absolute UTC expiry recorded in policy after approval. This is a proposal, not an authorization. It does not cover Native release, new vulnerabilities, merge, Production deployment, a paid Preview pair, or changes to security settings. The release decision remains `USER_ACCEPTED_EXACT_EXCEPTION` and selected audit remains `NON_PASS` while such an exception applies.
