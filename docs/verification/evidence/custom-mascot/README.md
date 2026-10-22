# Custom mascot creator verification

Recorded on 2026-10-21 in Chromium against an isolated fake-engine fixture.
The fixture used its own data directory, HOME, provider configuration, and ports.
This record describes that sealed fixture only. A later host Codex appserver
route and home could not be proven fixture-owned and were stopped; no evidence
from that route is included here.

## Recorded workflow

1. Open a bot's **Identity → Avatar → Create mascot** panel. Import
   [bunny.svg](bunny.svg), name it `まきうさぎ`, and save without changing the
   suggested face placement. The request returned HTTP 201; the stored anchor
   was `{ x: 113.824, y: 150.426, scale: 0.6237 }`.
2. Import a second closed outline as `まきまる`, save it, and select the Bunny
   again. Both shapes remain in the bot's saved list.
3. Copy the Bunny to another bot. Its native gradient follows the destination's
   red color; the source remains blue and the untouched fixture bot keeps its
   green standard Cursor body.
4. Reset to a standard body and select the Bunny again. Reset preserves both
   saved custom shapes.
5. Reload the page and restart the fixture backend with the same data directory.
   The complete mascot profiles and colors are identical before and after.
6. Use the existing working, thinking, and happy expression buttons. The
   recording shows the shared native renderer responding to those controls.

## Images and recording

- [Before](before.png): the previous native Cat avatar card.
- [Creator](creator.png) / [panel detail](creator-panel.png): import, animated
  preview, face controls, save action, and saved/reusable shapes.
- [Applied on another bot](applied.png): the copied Bunny in the destination's
  color, including the sidebar and header.
- [Clipped face rejected](invalid-face.png): moving the face outside the outline
  disables Save.
- [1024 × 768 viewport](compact.png): controls remain inside the viewport and
  Save is reachable by scrolling; no document horizontal overflow was observed.
- [Actual UI recording](motion.mp4): a 12.4-second recording of import, save,
  and the standard expression controls. It was trimmed from the browser's
  recording; no mascot animation was synthesized for the evidence.

The motion samples contain four distinct face-path hashes and one body-outline
hash. They confirm the recorded expression changes while preserving the same
outline. The two sampled creator gaze frames have equal face-path hashes;
these samples do not establish pointer-gaze behavior.

## Input and persistence checks

Malformed, active-content, and oversized (132,202-byte) SVG files were rejected
through the actual file chooser. The existing draft name and outline survived
each rejection. No imported script executed and no request reached the external
test URL. A face outside its outline could not be saved.

Only one closed SVG outline is supported. Imported markup is converted to
bounded numeric points; the saved profile contains no original SVG markup.
The creator does not import a complete multicolor illustration as an animated
native mascot.

## Acceptance boundaries

This record covers the browser renderer and fake-engine persistence. Installed
Electron and mobile runtime verification remain outside this record. Transfer,
backup, validation, and legacy projection also have automated coverage.

After the media was captured, a non-UI follow-up changed package look-stamp
projection in `server/package-import.ts` and `server/package-parts.ts`, with
focused tests. The creator, native renderer, and API-save sources remain at the
hashes recorded in `proof.json`; the existing screenshots and video remain
bound to their captured source snapshot and do not claim to exercise the new
package-hash logic.

At HEAD `0e24c4c`, Ubuntu and macOS each reported one shard-4 failure: the shelf
test required release hash `r` to equal written hash `w`. For an omitted body,
the release hashes `null` while the installed bot hashes its selected builtin
Cursor projection. Those are separate provenance values; the updated test now
checks each expected hash and the selected profile. The other seven failure
statuses were aggregates and are not attributed here. The focused package,
manifest, and organization-library suites passed 108 tests; typecheck, lint,
and diff check passed. See [test-triage.md](test-triage.md) for the recorded
scope and limits.

The initial local full-suite run showed 206 `server/index.test.ts` failures but
was stopped after source changed during the run and has no final test summary.
It is not a passing gate. A current focused custom-mascot validator run passed
4 tests; the old mixed-source result, including cached failure output, is not
current evidence.
