# PR366 exact audit acceptance window

Status: **PREPARED, NOT ACTIVATED**. This is risk acceptance, not vulnerability
remediation. The raw selected audit remains **NON_PASS / five HIGH**.

The owner approved this scope at `2026-10-19T15:53:58Z`, message
`Sentinel_2859b6c9b0908191a8647cc7508aa2bc`. The one window is fixed until
`2026-10-22T14:00:00Z` (Taipei October 22, 22:00). At the deadline the window is expired;
there is no rolling duration or automatic renewal. This replaces the previously
expired policy only under this new authorization; it does not retroactively
validate old receipts.

Only GHSA-vfj7-8cjw-p6xm and the currently locked five HIGH entries are covered:
eslint-config-next 16.3.6 -> @next/eslint-plugin-next 16.3.6 -> fast-glob 3.3.1 ->
micromatch 4.0.8 -> braces 3.0.3. Existing exact audit checks retain package/node,
version, integrity presence, advisory source/range, via/effects and count checks.
Both semantic lock identity and exact lock bytes are bound. Native and any new
advisory, version or lock change are excluded. No vendor experiment is resumed.
The sole subsequent amendment is the owner-approved follow-redirects 1.16.0 ->
1.16.1 patch below; every other version/lock change remains excluded.
Approved byte hashes use the committed Git blobs (LF) for the required hosted
Linux checkout; MSI's CRLF working-copy hashes differ and are not substituted for
those values. Activation still checks the actual candidate file bytes exactly.

## Approved narrow lock amendment, 2026-10-21

Owner message `Sentinel_a4cb747e08008191a8ca1859de6f791a` approved only the
follow-redirects patch in candidate `86bd17f450d32cf69f8560102150d91656edc5af`,
rebinding the original five HIGH exception and running free CI. The previous
authorization identity/time remain recorded separately and are not rewritten.
No new advisory or Native risk is accepted. The five complete audit entries and
their locked package entries are unchanged. Raw audit remains NON_PASS and the
original findings remain NOT_FIXED. Expiry stays `2026-10-22T14:00:00Z`.

The entire lock changes only follow-redirects version, tarball and integrity:

- Semantic SHA256: `00f3c2b4363f58e2485fb9139142ac9d611671ad04e8561150cf35be8015bc6c`
  -> `7273203027bb3e4c194cedcc5890bcc9d164c9d41a0b8dee9ae3e1f081c62f97`.
- Git LF bytes SHA256: `d284d352264e152619d134d21c5323005e2727f314672e74ff3dff54e91379ef`
  -> `51d616877d27acbb72a1c788fad7ea6c80abdcd045f99c6254b29b6eaa978732`.

The verifier requires the new exact hashes and separate amendment metadata;
stale hashes, other lock deltas and deadline changes remain rejected. Prior
activations cannot transfer: the final candidate still needs a fresh hosted
Linux install/SBOM/lint/build/NFT/isolation activation. This approval does not
authorize a second paid hosted acceptance or bypass Production release gates.

## Evidence collection and activation

The tracked policy contains the authorization, fixed expiry, preparation base,
reviewed lock and lint configuration hashes. It deliberately contains **no final
candidate SHA or completed activation receipt**. A commit containing its own SHA
or artifact proof would be self-referential and invalid.

After the final commit, the existing fresh Web scope runner must generate new
external evidence from that exact checkout. Each later commit invalidates prior
candidate/Plan receipts and requires new evidence; being a descendant of the
preparation base does not by itself activate the exception.

1. Preserve raw audit and assess the exact five findings. The intermediate
   disposition is `PENDING_EXCEPTION_ACTIVATION`, never accepted.
2. Verify the selected Web installation, generate/supplement the CycloneDX SBOM,
   and verify installed/SBOM coverage. Run the actual repository lint command and
   bind its successful log digest. Capture reviewed config hash and effective
   unset `next.rootDir` with no-html-link-for-pages enabled.
   Credential and loopback endpoint checks run before lint/build execution and
   again when activation evidence is collected.
3. Prepare the exact source snapshot and perform a fresh build. The existing
   artifact verifier checks source/lock freshness, traces, manifests, physical
   installed closure and Native exclusion. Under this exception it additionally
   rejects these five packages in source literal imports, compiled literal
   imports or NFT package closure, including Next compiled micromatch paths.
4. Require fresh Linux GitHub-hosted CI, exact workspace and workflow SHA, run /
   attempt / job identity, an ancestry check against the preparation base, no
   tracked changes and no untracked files outside this invocation's evidence
   directory. Ignored release source, root dotenv, npm and build/lint config inputs
   also block; dotenv cannot silently add credentials unseen by the parent
   process. Database and Supabase service endpoints must be loopback.
5. Reject nonempty environment credentials matching secret/token/password,
   private-key, service-role, API/access-key or credential names, including
   Supabase Primary/DR aliases, Vercel, Cloudflare, GitHub and OIDC credentials.
   Only the runner's ephemeral `ACTIONS_RUNTIME_TOKEN` for artifact transport is
   excepted. This is an environment/runner contract, not an OS/network sandbox
   attestation or permission to use production credentials. It does not change
   workflow permissions, credentials or provider state.
6. Only then emit `exception-activation.json` and accepted result, binding HEAD,
   tree, source, raw lock, policy, artifact/build ID, audit/SBOM, installed graph,
   lint and isolation evidence. The deadline is checked again at activation.

Plan validation requires each accepted receipt to carry a matching activation;
wrong SHA, stale artifact, missing evidence, policy drift, isolation or lint
failure and expiry remain blocking. Plan/Apply may have different fresh build
IDs, but each must match its own activation and share exact source/lock/installed
graph/verifier/policy bindings. Zero-vulnerability receipts keep the separate
strict path and do not silently replace a previously approved audit disposition.

These structured receipts are not cryptographic signatures. Trust still depends
on reviewed source, exact-run GitHub artifact provenance and downstream provider
readback. Copying/synthesizing JSON or environment flags is not evidence.
`runtimeLoaderSafety` remains `NOT_PROVEN`; the added package exclusion is limited
to reviewed source literal imports and NFT closure. It does not prove arbitrary
dynamic loading safe, scan deployed Production, or waive existing hosted gates.

## Current result and next blocking action

The MSI Windows worktree cannot satisfy the hosted Linux contract. No activation,
formal deployment artifact or completed acceptance is claimed. Local tests use
explicit synthetic evidence to exercise refusal and success branches; they do
not activate the policy. Final local test receipts belong outside the repository
and must name the post-commit SHA without another evidence-only commit.

After local verification/review, the next required action is separately approved
push and an exact-candidate fresh hosted evidence run within the fixed window,
subject to the previously required resource/cost approval. Until actual evidence
exists, the exception remains pending and release is blocked. DB/Edge, DR restore
and conversion, session/browser acceptance and exact Vercel evidence remain
separate gates. No push, dispatch, merge, deployment, paid resource, DR mutation,
Docker restart, credential or permission change is authorized here.
