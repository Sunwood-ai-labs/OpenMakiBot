# Upstream review follow-up

Initial review backport: `d4fa5f502971488d59bb4322e08675baf52c89dc`.
Current fork runtime source: `76322ef183bf1c0612b3ac38609cd11b05b0e14f`.
Current upstream runtime source: `bb7080d32b79ad7fc463b856d58790e4737155b6`,
including a merge of upstream main `bd5e209250957308305d4eb9d66ca17813008cf6` (0.1.122).

Upstream proposal: [OpenMausBot #3240](https://github.com/milind-soni/OpenMausBot/pull/3240),
ready and open, not merged as checked on 2026-10-22. The
[earlier production browser evidence](https://github.com/Sunwood-ai-labs/OpenMakiBot/blob/26d28455d85f16f81b81e82c9b0b36366720902b/docs/verification/evidence/custom-mascots/README.md)
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
