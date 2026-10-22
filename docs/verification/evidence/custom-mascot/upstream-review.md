# Upstream review follow-up

Initial review backport: `d4fa5f502971488d59bb4322e08675baf52c89dc`.
Current fork runtime source: `76322ef183bf1c0612b3ac38609cd11b05b0e14f`.
Current upstream runtime source: `f4f2d46e5240b6368d6eaf30aa65136e3b91711b`,
including a merge of upstream main `bd5e209250957308305d4eb9d66ca17813008cf6` (0.1.122).

Upstream proposal: [OpenMausBot #3240](https://github.com/milind-soni/OpenMausBot/pull/3240),
ready and open, not merged as checked on 2026-10-22. The
[earlier built browser-renderer fixture evidence](https://github.com/Sunwood-ai-labs/OpenMakiBot/blob/26d28455d85f16f81b81e82c9b0b36366720902b/docs/verification/evidence/custom-mascots/README.md)
is historical evidence for runtime `1dccf24c3242f8a5095bc577e7f5fedb65e2b262`.
Its 12 published files were anonymously retrieved and matched to Git bytes.
Current visual receipts are linked from the upstream proposal; each receipt
identifies its runtime source and media hashes separately from CI results.

The fork proposal [OpenMakiBot #9](https://github.com/Sunwood-ai-labs/OpenMakiBot/pull/9)
remains open against develop. Neither proposal has been merged; independent
fork adoption does not depend on the upstream proposal being accepted.

Original feature commits:

- `34aa54abd334e4944122de9612e46e995ffabdfd`
- `6b4d749834f8581e1f6e42d7346a058c1c487e73`
- `e8d4c245f0b41935e41031bfe7791293a2d26546`
- `0e24c4cf5d301a402c5637c0e0c940fa0c627cf7`
- `552cdc62774a73d7a71741f49cd886a328ac8f76`

The custom-shape POST now uses the same client scope as other appearance edits.
Avatar generation snapshots the canonical mascot profile, so a late generated
image cannot replace a newly selected native or custom mascot. An explicit
profile also takes precedence over a simultaneous legacy body field.

The new gradient Cat uses `kitten`, preserving upstream's existing Halloween
`cat`. This fork migrates its earlier `cat` body and profile selections while
retaining saved shapes. Package parsing preserves raw legacy values until the
release look hash is calculated, then installs the canonical profile. Tests
assert release `r` and written `w` independently; they can legitimately differ.

## Initial review backport verification

Verification of `d4fa5f502` used disposable homes and no real provider turns:

- Auth and avatar suites: 88 passed; final auth-only rerun: 47 passed.
- Store profile and legacy-Cat migration filters: 4 and 1 passed.
- Shared geometry/catalog suites: 48 passed; body generation passed.
- Package import: 9 passed; package parts and bot-package: 19 passed.
- Raw legacy-profile library stamp regression: 1 passed, retaining its shapes.
- Typecheck, lint, locale validation, and diff checks passed.

The full `pnpm test` script was not run for that initial follow-up. The earlier media
and source manifests in this directory remain historical evidence for their
recorded revisions; they do not claim to capture this backport commit. Installed
Electron and mobile runtime UI checks remain outside the browser evidence.

## CI repair follow-up

- `16214f5fc`: preserve omitted legacy cursor bodies in exports while retaining
  explicit cursor choices; catalog assertions use the canonical body list.
- `fca0d945c`: group-goal fixtures wait for their fake CLI to consume the exact
  prompt before the intended group or Stop action. The 12 cases passed twice
  in short disposable runtime paths; behavior assertions and timeouts remain.
- `3400275f6`: track explicit appearance choices in a transient Store-owned
  WeakMap and reject generated images after a record or choice change,
  including a same-value selection. No revision is persisted or sent on wire.
  The Store and deferred loopback HTTP cases passed (2 passed, 420 unrelated
  filtered cases); typecheck passed at this committed runtime.

The generic repairs retain the source-only Cat migration and independent raw
release `r` versus canonical written `w` package hashes. A separate unsharded
run at `fca0d945c` is not an exact-head result for the later backport. Consult
the checks on each PR's published head for current CI results.

Upstream 0.1.122 added a different Simple settings panel and cloud appearance
transfer path. The upstream proposal now exposes the creator in that panel
and carries custom profiles through its look payload, hash, and validated
patch route. Those surfaces are absent from this older fork. Its identity
and passkey browser CI launcher files are also absent, so upstream's bounded
navigation retry and browser-home isolation changes were not copied here.

## Compact SVG arcs and stored-profile recovery

- Upstream `f68e9475b` was backported as `bb46416e3`. Arc flags are consumed
  as individual grammar operands, accepting adjacent flags and coordinates
  without weakening numeric, bounds, separator, or closed-path validation.
- Upstream `bb7080d32` was adapted as `b77358092`. A present but invalid
  stored profile now preserves the exact original registry in a private,
  content-addressed recovery file before the safe fallback is persisted.
  Conflicting recovery contents or I/O failure stop startup before the
  registry is rewritten. Missing legacy profiles need no recovery copy.
- `76322ef18` aligns the older fork atomic writer's type with its existing
  byte support, preserving Buffer snapshots without UTF-8 conversion.
- The fork keeps its Cat migration, omitted versus explicit cursor fields,
  raw release hashes, and appearance revision behavior. Its normalization
  block was extracted and Store shrank by three lines.

The full fork Store and SVG parser checks passed in sealed disposable homes:
175 passed, one existing skip, and no suite-originated external network
attempts. The corresponding upstream Store and size-ratchet checks passed
155 cases with one existing skip; its parser passed all 31 cases. Recovery
failure, byte preservation, repeated startup, and supported file permissions
are covered by those checks. Each runner's separate network-guard preflight
deliberately blocks three diagnostic requests; those are not suite traffic.

These source checks do not replace the runtime-specific visual receipts.
The current upstream browser evidence is linked from PR #3240. The older
fork media remains historical, and current CI is determined by the checks
on each PR's published head.

## Upstream-only initial-frame animation correction

Upstream commit [f4f2d46e](https://github.com/milind-soni/OpenMausBot/commit/f4f2d46e5240b6368d6eaf30aa65136e3b91711b) clamps a negative first-frame time delta to zero in `src/components/CarvedAvatar.tsx`, preventing the initial animation frame from producing a negative ellipse radius. The fork at `84df1add6c645db681f3ed277f0b9b7b57726008` has no tracked `CarvedAvatar.tsx`, so this upstream-only change has no fork equivalent to backport. The fork UI evidence was captured at `76322ef183bf1c0612b3ac38609cd11b05b0e14f` and predates the later server changes.

Upstream commit [f4f2d46e](https://github.com/Sunwood-ai-labs/OpenMakiBot/commit/f4f2d46e5240b6368d6eaf30aa65136e3b91711b) carries this correction; fork PR [#9](https://github.com/Sunwood-ai-labs/OpenMakiBot/pull/9) remains independent. PR #9 CI run [#41](https://github.com/Sunwood-ai-labs/OpenMakiBot/actions/runs/39709807035) completed on the exact published head `84df1add6c645db681f3ed277f0b9b7b57726008` with 29 successful jobs and the Cloudflare deployment job skipped. That run does not validate a later documentation head. This update makes no additional visual-acceptance claim.

## API validation and persistence-error boundary

Upstream commit [`46862db5`](https://github.com/milind-soni/OpenMausBot/commit/46862db5a8072cf50bdd904515d8b4a3ebcdba1a) gives caller-correctable mascot-profile limits and ID/content collisions a typed validation error. Fork commit [`170f4cbaf`](https://github.com/Sunwood-ai-labs/OpenMakiBot/commit/170f4cbafa6578e0945bc3d84bf45795989eb978) adapts that boundary while preserving the fork API's 422 response. Unexpected persistence failures use a fixed generic 500 response without exposing local storage paths; the existing transactional behavior remains, and the regression checks that the bot is not updated when saving fails.

The focused sealed Windows fixture `20261022T042853Z-e1742c91` ran against a worktree based at `3376d6385b77cc42fa179c822f1d60135b33da86` with the storage change present as working-tree edits. Its selected `server/index.test.ts` cases passed 2 tests with 279 of 281 filtered. The receipt records zero suite-originated blocked network attempts and three deliberate network-guard preflight blocks. A separate sealed command `20261022T043220Z-e648c05b` exited successfully and reports `shared/custom-mascot.test.ts` passing 6 of 6 tests. Its command also named `scripts/testing/file-size-ratchet.test.ts`, which is absent from this fork checkout; Vitest listed only the shared suite, so this receipt is not evidence that a fork ratchet suite ran.

The historical [PR #9 CI run 39714944273](https://github.com/Sunwood-ai-labs/OpenMakiBot/actions/runs/39714944273) completed on published head `3376d6385b77cc42fa179c822f1d60135b33da86` with 29 successful jobs and one guarded deployment skip. It predates the later storage and Boat fixture commits and is not their CI result. Check the current [PR #9 checks](https://github.com/Sunwood-ai-labs/OpenMakiBot/pull/9/checks) for the published head. The fork's visual evidence remains historical for runtime `76322ef183bf1c0612b3ac38609cd11b05b0e14f`; no new UI verification is claimed for these server changes.

Fork commit [`91dd3d0b`](https://github.com/Sunwood-ai-labs/OpenMakiBot/commit/91dd3d0bbc637f206686677fa932b0c6aba5a703) replaces the Boat rename lifecycle test's delay and polling window with its existing deferred gate. The test keeps its token-conflict and successful-provisioning assertions; no timeout or skip changed. Upstream commit [`3e49af85`](https://github.com/milind-soni/OpenMausBot/commit/3e49af8594dc9a7444587c68f4f0d12dcf911a6f) prioritizes an explicitly selected custom silhouette over seasonal body dressing. The fork has no corresponding `CarvedAvatar` / `wornBody` behavior, so this change has no fork equivalent. The upstream cloud E2E, appearance-card, and egress fixtures also have no corresponding paths in this fork; no backport is claimed for them.
