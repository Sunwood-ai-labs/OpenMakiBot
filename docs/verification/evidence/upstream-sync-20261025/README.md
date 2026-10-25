# OpenMakiBot upstream synchronization — 2026-10-25

This review merges fork/develop `717ab09f` with the pinned
`milind-soni/OpenMausBot` main commit `03a6e88bc13ad2c2fb5c16a80d1a0b732b88d588`
(package version `0.1.127`). The merge is prepared on
`codex/sync/upstream-20261025`. The local merge is complete; protected-branch integration still requires a reviewed PR and successful CI.

The merge keeps the OpenMakiBot identity and fork-only publishing boundaries.
Upstream HTML, CSV/TSV table previews, folder listings, outside-workspace
guidance, browser/page openers, thread links and Markdown behavior are retained.
The fork's image, PDF, video, XLSX/XLS/ODS and PPTX previews remain message-
scoped. PDF and Office preview actions coexist with upstream save and folder
handling; CSV/TSV stay on the upstream table preview path.

Upstream removed the Android and iOS source trees. Their protected status names
remain as conditional checks: they skip while the trees are absent, and fail if
the sources return before native verification is restored. This is not native
test coverage. The fork's Vitest scope emits the real macOS, Ubuntu and Windows
shard matrix: 4 macOS, 8 Ubuntu and 8 Windows shards. Ubuntu runs all E2E tests; macOS and Windows use upstream host-dependent E2E selection.

## Isolated UI verification

`scripts/verify-file-preview.ts --built` ran against a disposable fixture and
the production build. It used generated sample files and fake bot responses,
then exited through the fixture's normal `stop` cleanup path. It did not use the
live app or user data.

| Surface | Before | After |
| --- | --- | --- |
| Chat and attachment gallery | ![Before overview](before-overview.png) | ![After overview](after-overview.png) |
| PDF page 2 | ![Before PDF page 2](before-pdf-page2.png) | ![After PDF page 2](after-pdf-page2.png) |
| Workbook Checks sheet | ![Before workbook](before-workbook-checks.png) | ![After workbook](after-workbook-checks.png) |
| PPTX slide 2 | ![Before PPTX slide 2](before-pptx-slide2.png) | ![After PPTX slide 2](after-pptx-slide2.png) |
| Loaded video | ![Before video](before-video-loaded.png) | ![After video](after-video-loaded.png) |

The final UI review confirmed PDF page `2/2`, the workbook Checks sheet with
literal markup preserved as text, PPTX slide `2/2`, and video playback from
paused through playback to a clean `3/3` end state. The video timing receipt is
in [after-video-playback.json](after-video-playback.json). The fixture closed
its tab, returned `cleaned: true`, and its process exited.

## Commands and results

- `pnpm install --lockfile-only --ignore-scripts` — completed with pnpm `10.33.0`.
- `pnpm install --frozen-lockfile --ignore-scripts` — completed; no lifecycle scripts ran.
- `node scripts/check-fork-policy.mjs` — passed; fork identity, repository guards, protected check names and 3 OS matrix structure are present.
- `node --test scripts/check-fork-policy.node-test.mjs` — 11/11 passed, including rejection when the fork Vitest matrix override is removed and when workflow-level external credentials lack repository guards.
- `pnpm exec vitest run scripts/ci-scope.test.ts scripts/ci-workflow.test.ts scripts/testing/verification-docs.test.ts` — 3 files and 86 tests passed.
- Fork scope runtime probe — emitted 20 shards (4 macOS, 8 Ubuntu, 8 Windows); Android and iOS source outputs were `false`.
- `pnpm i18n:check` — passed for 13 catalogs and 6,321 English source strings; Japanese has 6,319 translations.
- `pnpm exec vitest run scripts/ci-workflow.test.ts server/message-file.test.ts src/components/AttachmentPreview.test.ts src/components/ChatMarkdown.test.ts src/components/HtmlFilePreview.test.ts src/components/RichTable.test.ts src/components/AttachmentGallery.test.ts src/components/FilePreview.test.ts src/lib/file-preview.test.ts src/lib/load-file-preview.test.ts` — 9 files and 233 tests passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed, including the server TypeScript build and production Vite build.

Vite reported CSS warnings for `::highlight(search-result-text)` and
`::highlight(omb-citation-source)`, plus a chunk larger than 500 kB. The build
completed successfully.

## Remaining verification

Official CI on the exact published candidate has not run yet; it must confirm
the configured three-platform matrix. Native Android/iOS functionality is not
covered because upstream removed those projects. No publisher, release,
deployment, Docker publish or external-secret workflow was executed locally;
the fork policy validator checked their repository guards.

The inherited SheetJS dependency remains pinned to
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Neither the fork-base
lock nor the regenerated lock records an integrity hash for this existing
tarball URL.

## CI compatibility repairs

The workbook sheet picker now uses the shared Select component. The outside-workspace action and message-local file link live in separate components with direct imports. The line-size ratchet was lowered after extraction.

The repaired source passed 161 focused preview and ratchet tests, the Select guard, targeted lint, and a full production build including both TypeScript checks. An independent source review passed. The After images above were recaptured from that production build in a disposable fixture; PDF page 2, workbook Checks, PPTX slide 2, and video playback were confirmed again. Independent image review passed, and the fixture exited through normal cleanup. The [source hashes](source-hashes.json) bind those captures to the repaired preview components.

Hosted CI still requires confirmation. The earlier integration run also reported Linux Cloud/home fixture failures; a controlled baseline-versus-candidate comparison is being investigated separately.
