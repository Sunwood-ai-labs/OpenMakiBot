# Upstream review follow-up

Backport code: `d4fa5f502971488d59bb4322e08675baf52c89dc`.
Upstream proposal runtime: `1dccf24c3242f8a5095bc577e7f5fedb65e2b262`.

Upstream proposal: [OpenMausBot #3240](https://github.com/milind-soni/OpenMausBot/pull/3240),
ready and open, not merged as checked on 2026-10-22. Published head:
`26d28455d85f16f81b81e82c9b0b36366720902b`; changes after the runtime commit are
documentation and media only. The [production browser evidence](https://github.com/Sunwood-ai-labs/OpenMakiBot/blob/26d28455d85f16f81b81e82c9b0b36366720902b/docs/verification/evidence/custom-mascots/README.md)
includes a continuous eight-second motion capture and independent acceptance.
Its 12 published files were anonymously retrieved and matched to Git bytes.

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

Verification used disposable homes and no real provider turns:

- Auth and avatar suites: 88 passed; final auth-only rerun: 47 passed.
- Store profile and legacy-Cat migration filters: 4 and 1 passed.
- Shared geometry/catalog suites: 48 passed; body generation passed.
- Package import: 9 passed; package parts and bot-package: 19 passed.
- Raw legacy-profile library stamp regression: 1 passed, retaining its shapes.
- Typecheck, lint, locale validation, and diff checks passed.

The full `pnpm test` script was not run for this follow-up. The earlier media
and source manifests in this directory remain historical evidence for their
recorded revisions; they do not claim to capture this backport commit. Installed
Electron and mobile runtime UI checks remain outside the browser evidence.
