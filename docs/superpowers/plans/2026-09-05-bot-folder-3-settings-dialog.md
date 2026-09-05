# Bot Folder, Step 3: The Bot Settings Dialog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 400px right-hand "Agent profile" strip with a centered bot-settings dialog shaped like the app Settings modal (left section rail, search), whose first page is a generated Overview that says in plain language what the bot is, does, can reach, and will not do, shows the exact system prompt with byte counts, and lists recent changes; give skills an Import-from-GitHub button; add consequence lines to proposal cards.

**Architecture:** All copy generation is pure and tested: `src/lib/schedule-label.ts` (moved out of the calendar page) and `src/lib/bot-overview.ts` (`overviewSentences(...)`) turn the bot record, routines, runs, webhooks, skills, engine capabilities, and connected-apps inventory into `{ who, does, reaches, wont }`. The dialog shell (`src/components/bot-settings/BotSettingsDialog.tsx`) is a copy of `SettingsModal`'s overlay/rail/body with its own section list; the store gains `botSettingsSection`. Each existing card of `SettingsPanel.tsx` moves verbatim into a section file under `src/components/bot-settings/`; `SettingsPanel.tsx` is deleted at the end. Presentational sections take everything by prop so they get static-markup tests.

**Tech Stack:** React 18, Tailwind classes via `cn`, Vitest with `react-dom/server` static markup for component tests (`.test.ts` files with `createElement`, never `.tsx` tests).

**Spec:** `docs/superpowers/specs/2026-09-05-bot-folder-and-self-setup-design.md` — Part 3 (Shape, Overview page, Cards say the consequence, History), Part 1 "Skills", rollout step 3.

**Depends on:** step 2 (`GET /api/bots/:id/history`, `POST …/history/rollback`, `profileRequest` cards) being on the branch. Step 1's `GET /system-prompt` and `GET /soul` are already there.

## Global Constraints

- Every Overview line is a sentence a non-technical person can read. The "Won't" section is never empty for a fresh bot and includes, when applicable: `Won't run commands without asking you first.` (auto mode off), `Won't contact other bots without asking.` (approvePeerComms on, or peers is `[]`), `Has no connected apps.` (composio off, key not configured, engine can't mount, or zero connected services), `Can't use a computer.` (computer `"off"`), `Won't act on a schedule.` (no enabled routines), `Won't change its own instructions without your approval.` (always).
- Defaulting idioms from the server hold: `bot.composio !== false` and `bot.browser !== false` mean on; `bot.computer` absent means auto.
- Connected apps are never shown as "none" when the inventory is not authoritative (`credentialStore === "unavailable"`); say `Connected apps could not be checked.` instead.
- "What the model sees" renders `GET /api/bots/:id/system-prompt` sections with label, byte count, collapsed text, and the total with `≈ N tokens`.
- The dialog uses the same overlay, dialog box, rail width, search box, header row, and scroller classes as `SettingsModal.tsx` so the two look like one family. Escape closes; backdrop click closes; focus is trapped the same way.
- All existing controls keep working with the same `dispatch({ type: "updateBot" … })` writes. No control is dropped.
- Tests are `.test.ts` files using `createElement` + `renderToStaticMarkup`; components under test take data by prop (no `useStore` inside presentational sections).
- Never push. Commit locally on `feat/bot-folder`; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Node 24 for tests. `pnpm typecheck && pnpm lint` clean per task; `pnpm build` (Vite) green at the end of Tasks 4, 6, 7.

---

## File map

- Create `src/lib/schedule-label.ts`, `src/lib/schedule-label.test.ts` — `niceTime`, `niceDate`, `intervalLabel`, `scheduleLabel`, `DAY_NAMES`, `runsPerDay` (moved from `RoutineCalendarPage.tsx`, which re-imports them).
- Create `src/lib/bot-overview.ts`, `src/lib/bot-overview.test.ts` — `overviewSentences`, `soulLead`, `lastRunFor`.
- Modify `src/state/store.tsx` — `BotSettingsSection`, `botSettingsSection` state, `toggleSettings` `section?`.
- Modify `src/state/store.test.ts` — reducer test.
- Create `src/components/bot-settings/BotSettingsDialog.tsx` — shell + rail + section switch + data loading for Overview/History.
- Create `src/components/bot-settings/sections.ts` — `BOT_SECTIONS` with labels, icons, keywords.
- Create `src/components/bot-settings/OverviewSection.tsx`, `OverviewSection.test.ts`.
- Create `src/components/bot-settings/PromptPreview.tsx`, `PromptPreview.test.ts`.
- Create `src/components/bot-settings/IdentitySection.tsx`, `SoulSection.tsx`, `SkillsSection.tsx`, `MemorySection.tsx`, `RoutinesSection.tsx`, `AccessSection.tsx`, `ModelSection.tsx`, `PermissionsSection.tsx`, `VoiceSection.tsx`, `HistorySection.tsx`, `UsageSection.tsx`.
- Create `src/components/bot-settings/useBotSettingsDerived.ts` — the derived flags block lifted from `SettingsPanel.tsx:541-611`.
- Create `src/components/bot-settings/field.ts` — `Field`, `inputCls` (shared with `SoulField.tsx`, which switches to importing it).
- Modify `src/App.tsx` — mount `BotSettingsDialog` instead of `SettingsPanel`.
- Delete `src/components/SettingsPanel.tsx` (Task 6).
- Modify `src/components/RoutineCalendarPage.tsx` — import labels from the new lib.
- Modify `server/routine-requests.ts`, `server/routine-requests.test.ts` — consequence line on routine cards; locate and extend the skill and credential card copy the same way (Task 8).

---

### Task 1: `src/lib/schedule-label.ts`

**Files:**
- Create: `src/lib/schedule-label.ts`, `src/lib/schedule-label.test.ts`
- Modify: `src/components/RoutineCalendarPage.tsx` — delete the module-private `niceTime`, `niceDate`, `durationLabel`, `intervalLabel`, `scheduleLabel` and `DAY_NAMES` (around lines 83 and 152–186) and import them from the new lib. Keep `durationLabel` in the lib too.

**Interfaces:**
- Produces: `DAY_NAMES: readonly string[]`, `niceTime(at: number): string`, `niceDate(at: number): string`, `durationLabel(minutes: number): string`, `intervalLabel(minutes: number): string`, `scheduleLabel(schedule: RoutineSchedule): string`, `scheduleSentence(schedule: RoutineSchedule): string` (lowercase lead-in for prose: `every 5 minutes`, `every weekday at 9:00 AM`, `once on Friday, September 5 at 3:00 PM`), `runsPerDay(schedule: RoutineSchedule): number | null` (interval → `Math.round(1440 / everyMinutes)`; daily → `weekdays.length / 7` rounded to 2 decimals; once → `null`).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";

import { intervalLabel, runsPerDay, scheduleSentence } from "./schedule-label";

describe("schedule labels", () => {
  it("names intervals", () => {
    expect(intervalLabel(5)).toBe("Every 5 min");
    expect(intervalLabel(60)).toBe("Every hour");
    expect(intervalLabel(120)).toBe("Every 2 hr");
    expect(intervalLabel(90)).toBe("Every 1 hr 30 min");
  });

  it("writes schedules as prose", () => {
    expect(scheduleSentence({ type: "interval", everyMinutes: 5, anchorAt: 0 })).toBe("every 5 minutes");
    expect(scheduleSentence({ type: "interval", everyMinutes: 60, anchorAt: 0 })).toBe("every hour");
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] })).toMatch(/^every weekday at /);
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toMatch(/^every day at /);
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [3] })).toMatch(/^weekly on Wed at /);
    expect(scheduleSentence({ type: "once", at: Date.UTC(2026, 8, 5, 12) })).toMatch(/^once on /);
  });

  it("estimates runs per day", () => {
    expect(runsPerDay({ type: "interval", everyMinutes: 5, anchorAt: 0 })).toBe(288);
    expect(runsPerDay({ type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] })).toBe(0.71);
    expect(runsPerDay({ type: "once", at: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL, implement, run → PASS**

Move the five functions and `DAY_NAMES` verbatim into `src/lib/schedule-label.ts` (import `atLocalTime` from `@/lib/routine-calendar` and `RoutineSchedule` from `@/lib/routines`), export them, add `scheduleSentence` (built from `intervalLabel` lowercased with "min" → "minutes", "hr" → "hours", and the daily/once branches as above) and `runsPerDay`. In `RoutineCalendarPage.tsx` replace the definitions with `import { DAY_NAMES, durationLabel, intervalLabel, niceDate, niceTime, scheduleLabel } from "@/lib/schedule-label";` — keep `scheduleLabel`'s accepted type wide enough for `CalendarCall["schedule"]` by typing the parameter as `RoutineSchedule | { type: "once"; at: number }` if `CalendarCall` needs it (read its type).

- [ ] **Step 3: Verify and commit**

```bash
pnpm vitest run src/lib/schedule-label.test.ts src/ && pnpm typecheck && pnpm lint
git add src/lib/schedule-label.ts src/lib/schedule-label.test.ts src/components/RoutineCalendarPage.tsx
git commit -m "refactor(routines): schedule labels as a tested library

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `src/lib/bot-overview.ts` — the sentences

**Files:**
- Create: `src/lib/bot-overview.ts`, `src/lib/bot-overview.test.ts`

**Interfaces:**
- Consumes: `Bot` from `@/state/store`; `Routine`, `RoutineRun` from `@/lib/routines`; `WebhookTrigger` from `@/lib/webhooks`; `scheduleSentence`, `niceTime` from `@/lib/schedule-label`.
- Produces:

```ts
export interface OverviewSkill { name: string; description: string; enabled: boolean; source: string }
export interface OverviewInput {
  bot: Bot;
  routines: Routine[];
  runs: RoutineRun[];
  webhooks: WebhookTrigger[];
  skills: OverviewSkill[];
  engine?: { agentsMcp?: boolean; composioMcp?: boolean; browserMcp?: boolean; computerMcp?: boolean } | null;
  connectedApps: { configured: boolean; authoritative: boolean; services: string[] }; // slugs currently connected
  sectionPeers: number; // other visible bots in the same section
  desktopBrowser: boolean;
}
export interface OverviewSentences { who: { name: string; title: string; blurb: string; soulLead: string }; does: string[]; reaches: string[]; wont: string[] }
export function soulLead(soul: string | undefined): string  // first paragraph, ≤ 240 chars, "" when empty
export function lastRunFor(routineId: string, runs: RoutineRun[]): RoutineRun | undefined  // newest by finishedAt ?? startedAt ?? scheduledFor
export function overviewSentences(input: OverviewInput): OverviewSentences
```

Rules for `does`: one sentence per **enabled** routine: `` `${capitalize(scheduleSentence(r.schedule))}, ${lowerFirst(r.name)}.${nextRun}${lastRun}` `` where `nextRun` is `` ` Next run ${niceTime(r.nextRunAt)}.` `` when set and `lastRun` is `` ` Last run ${status} at ${niceTime(at)}.` `` when a run exists; paused routines → `Paused: ${name}.`; one per enabled skill: `Knows how to ${lowerFirst(description || name)}.`; one per enabled webhook: `Listens for “${name}” webhooks.`.
Rules for `reaches`: computer (`Works on a cloud computer.` / `Works in the Local VM.` / `Can act on this computer.` / `Uses only the built-in browser.` / `Picks a computer automatically.` for absent); folder (`Works in ${bot.cwd}.` or `Works in its private workspace.`); connected apps (`Can use ${n} connected apps: a, b, c.` when on and authoritative and n>0; `Connected apps could not be checked.` when not authoritative); browser (`Has the built-in browser.` when `bot.browser !== false && desktopBrowser && bot.computer !== "off"`); team (`Can talk to ${sectionPeers} other bots in its section.` when engine.agentsMcp and peers>0); chief (`Coordinates its section as Chief of Staff.`).
Rules for `wont`: exactly the six from Global Constraints, each under its condition; `Has no connected apps.` when `bot.composio === false || !configured || !engine?.composioMcp || (authoritative && services.length === 0)`.

- [ ] **Step 1: Failing tests** — cover: a fresh bot yields all six `wont` lines and `does: []`; auto mode on drops the first; an enabled 5-minute routine with a completed run yields `Every 5 minutes, triage discord. Next run … Last run completed at ….`; a paused routine → `Paused: …`; connected apps authoritative with 2 services → `Can use 2 connected apps: gmail, linear.`; not authoritative → `Connected apps could not be checked.` and no `Has no connected apps.`; `soulLead` cuts at the first blank line and 240 chars.

- [ ] **Step 2: Run → FAIL, implement, run → PASS.** Keep the module free of React and store imports beyond types.

- [ ] **Step 3: Verify and commit** (`pnpm vitest run src/lib/bot-overview.test.ts && pnpm typecheck && pnpm lint`; commit `feat(overview): plain-language sentences for a bot's overview`).

---

### Task 3: Store — a section for the bot dialog

**Files:**
- Modify: `src/state/store.tsx` — add `export type BotSettingsSection = "overview" | "identity" | "soul" | "skills" | "memory" | "routines" | "access" | "model" | "permissions" | "voice" | "history" | "usage";`, state `botSettingsSection: BotSettingsSection` (initial `"overview"`), action `{ type: "toggleSettings"; open?: boolean; section?: BotSettingsSection }`, reducer sets `botSettingsSection: action.section ?? state.botSettingsSection`, and resets to `"overview"` when `select` changes the selected bot (find the `select` case).
- Test: `src/state/store.test.ts` — `toggleSettings` with a section sets it and opens; without a section keeps it; selecting another bot resets to overview.

Keep the existing mutual exclusion exactly as it is (bot settings, computer, inspector, app settings share the slot) — the dialog still closes those. Ruling recorded in the ledger.

Commit: `feat(store): bot settings dialog remembers its section`.

---

### Task 4: The dialog shell, Overview, Identity, Soul

**Files:**
- Create: `src/components/bot-settings/sections.ts`, `BotSettingsDialog.tsx`, `OverviewSection.tsx`, `OverviewSection.test.ts`, `PromptPreview.tsx`, `PromptPreview.test.ts`, `IdentitySection.tsx`, `SoulSection.tsx`, `field.ts`, `useBotSettingsDerived.ts`
- Modify: `src/App.tsx` (mount), `src/components/SoulField.tsx` (import `inputCls` from `./bot-settings/field`)

**Interfaces:**
- `sections.ts`: `BOT_SECTIONS: Array<{ id: BotSettingsSection; label: string; icon: LucideIcon; keywords: string[] }>` in the order overview, identity, soul, skills, memory, routines, access, model, permissions, voice, history, usage, with labels `Overview, Identity, Soul, Skills, Memory, Routines, Access, Model, Permissions, Voice & alerts, History, Usage`.
- `BotSettingsDialog({ bot })`: copies `SettingsModal`'s return JSX (overlay `fixed inset-0 z-50 …`, dialog `h-[560px] w-full max-w-[860px] …`, rail `w-[190px] …`, search, header row, scroller) with `dispatch({ type: "toggleSettings", … })` in place of `toggleAppSettings`, title `bot.name`, `aria-labelledby="bot-settings-title"`, and the same Escape/Tab focus-trap effect. Renders the active section. Loads on open (and when `bot.id` changes): `GET /api/bots/:id/skills`, `GET /api/bots/:id/system-prompt`, `GET /api/bots/:id/history?limit=5`, and `preloadConnectedApps()` from `PluginsPanel.tsx` (reuse; do not duplicate its cache), passing results down. Wrap each fetch so one failure leaves that block reading "couldn't load" rather than breaking the dialog.
- `OverviewSection` props: `{ sentences: OverviewSentences; prompt: PromptPreviewData | null; recent: HistoryRow[]; onOpen: (section: BotSettingsSection) => void }` — pure presentational. Layout in reading order: **Who** (name, title, blurb, soulLead + "Read all" → `onOpen("soul")`), **Does** (list, or `Nothing scheduled or learned yet.`), **Can reach**, **Won't**, **What the model sees** (`<PromptPreview>` collapsed), **Recent changes** (up to 5 rows `summary · when`, link → `onOpen("history")`).
- `PromptPreview` props: `{ data: { sections: Array<{ id: string; label: string; text: string; bytes: number }>; totalBytes: number; approxTokens: number; note: string } | null; open: boolean; onToggle(): void }` — header `What the model sees · ${totalBytes.toLocaleString()} bytes ≈ ${approxTokens.toLocaleString()} tokens`; when open, one row per section: label, bytes, and a `<details>` with the text in a `<pre>`; `note` in small text.
- `IdentitySection({ bot, patch, activeState, mascotMotion })`: `BotProfileAvatarCard` + Name + Title + Instructions (the existing description textarea block, relabelled **Blurb** with helper text `One line shown in rosters and on the phone. Long instructions belong in Soul.`; keep the 4,000 counter and the "View full" dialog).
- `SoulSection({ bot, patch })`: `<SoulField>` plus a short intro `Who this bot is and the rules it never breaks. Always in its context.`.
- `field.ts`: `export const inputCls = …` (moved from SettingsPanel) and `export function Field(...)` (moved).
- `useBotSettingsDerived(bot)`: returns every derived value from `SettingsPanel.tsx:541-611` (`patch`, `engine`, `canAutoReview`, `canCoordinate`, `canUseConnectedApps`, `canUseVps`, `connectedAppsConfigured`, `connectedAppsEnabled`, browser flags, `sectionName`, `currentChief`, `botRoutines`, `activeBotRoutines`, `localSelectable`, `localDisabledReason`, `activeState`, `mascotMotion`) — lifted verbatim, so the section files can be verbatim moves.

- [ ] **Step 1: Failing tests** — `OverviewSection.test.ts`: render with a fixture `sentences` and assert the six won't lines, a does line, `Read all`, and `Nothing scheduled or learned yet.` for empty does. `PromptPreview.test.ts`: closed shows the header with bytes and tokens; open shows one row per section with its label and byte count.
- [ ] **Step 2: Implement.** Copy the shell from `SettingsModal.tsx` lines 573–642 adjusting ids/actions; wire sections `overview | identity | soul` and render a small placeholder (`Moving in the next commit.`) for the others so the dialog is complete at this commit.
- [ ] **Step 3: Mount.** In `src/App.tsx` replace `{state.settingsOpen && bot && <SettingsPanel bot={bot} />}` with `{state.settingsOpen && bot && <BotSettingsDialog bot={bot} />}` and remove the `SettingsPanel` import. Leave `SettingsPanel.tsx` in place until Task 6 (unused file, lint may need `// eslint-disable` — prefer deleting nothing yet and accepting an unused-export warning only if lint treats it as a warning; if it is an error, move Task 6's deletion here and finish the remaining sections in the same commit).
- [ ] **Step 4: Verify** — `pnpm vitest run src/ && pnpm typecheck && pnpm lint && pnpm build`. Then run the dev app against a fixture (`node --experimental-strip-types scripts/control-omb.ts launch`, then `OMB_PORT=<port> pnpm dev --port 5199`) and open a bot's settings: the dialog appears centered with the rail, Overview renders, Escape closes.
- [ ] **Step 5: Commit** `feat(settings): centered bot settings dialog with a generated overview`.

---

### Task 5: Skills, Memory, Routines, Access sections

**Files:**
- Create: `SkillsSection.tsx`, `MemorySection.tsx`, `RoutinesSection.tsx`, `AccessSection.tsx`
- Modify: `BotSettingsDialog.tsx` (wire them)

**Interfaces:**
- `SkillsSection({ bot })`: the whole `LearnedSkillsCard` (SettingsPanel.tsx:79–295) moved verbatim, its nested review dialog `z-[80]` → `z-[90]` so it floats above the dialog, plus an **Import from GitHub** row: input (placeholder `owner/repo or https://github.com/…/SKILL.md`) + button → `api(\`/api/bots/${bot.id}/skills\`, { method: "POST", body: JSON.stringify({ source }) })`; on 201 refresh the list and show `Imported ${installed.length} skill(s)`; on error show the server's message. Each skill row shows: name, description, `Used when the bot decides it's relevant` (there are no triggers on learned skills), source, enabled toggle, and the existing review/delete controls. Row click → `GET /api/bots/:id/skills/:name` in a read-only `<pre>`.
- `MemorySection({ bot })`: `MemoryCard` moved verbatim.
- `RoutinesSection({ bot, routines, runs })`: one row per routine: `${capitalize(scheduleSentence)} · ${name}`, state chip Active/Paused, `Next ${niceTime(nextRunAt)}`, `Last ${status} ${niceTime(at)}` via `lastRunFor`; buttons New schedule (opens `RoutineEditor` with `lockedBotId`) and Manage (`dispatch({ type: "showRoutines" })`), moved from the Scheduled tasks card.
- `AccessSection({ bot, derived })`: **Works on** control + cloud backend + auto-start VPS (moved), **Working folder** (`WorkingFolder` moved), **Connected apps** toggle (moved) plus the list of connected service slugs when authoritative, **Browser** toggle (moved), **Webhooks** list (name, enabled, `${deliveryCount} deliveries`, from `state.webhooks.filter(w => w.botId === bot.id)`), and **Always allowed** list of `bot.alwaysAllow ?? []` with a per-entry remove button that patches the filtered array (this is the first read-only view of standing grants).

- [ ] **Steps:** move code, wire, `pnpm typecheck && pnpm lint && pnpm vitest run src/`, manual check in the dev app that each section renders and its controls still save, commit `feat(settings): skills, memory, routines, and access sections`.

---

### Task 6: Model, Permissions, Voice & alerts, History, Usage; retire the strip

**Files:**
- Create: `ModelSection.tsx`, `PermissionsSection.tsx`, `VoiceSection.tsx`, `HistorySection.tsx`, `UsageSection.tsx`
- Modify: `BotSettingsDialog.tsx`
- Delete: `src/components/SettingsPanel.tsx`

**Interfaces:**
- `ModelSection`: `ModelPicker` (drop `contained` — the dialog is wide) + Effort control (moved).
- `PermissionsSection`: Auto mode, Review routine approvals, Ask me before contacting other bots, Chief of Staff (all moved).
- `VoiceSection`: `VoiceSettings` + Notifications (moved).
- `HistorySection({ bot, rows, onRollback })`: rows newest first: `when · actor via · summary`; for `field === "soul"` rows with `before` a **Restore this version** button → `POST /api/bots/:id/history/rollback { at }`, then reload; empty state `No changes recorded yet.`. `BotSettingsDialog` loads `GET /history?limit=100` when the section opens.
- `UsageSection`: `BotUsageCard` moved; its "All bots →" button keeps dispatching `toggleAppSettings` (which closes this dialog — intended).

- [ ] **Steps:** move code, wire, delete `SettingsPanel.tsx`, grep for remaining imports of it, `pnpm typecheck && pnpm lint && pnpm vitest run src/ && pnpm build`, manual check of every section, commit `feat(settings): model, permissions, voice, history, usage; retire the side strip`.

---

### Task 7: Overview data plumbing and polish

**Files:**
- Modify: `BotSettingsDialog.tsx`, `OverviewSection.tsx`

- Compute `overviewSentences` in the dialog from `state.routines`, `state.routineRuns`, `state.webhooks`, the fetched skills, `derived.engine?.capabilities`, the connected-apps inventory (`configured`, `authoritative`, connected slugs), `sectionPeers` (visible bots in the same section minus this one), `Boolean(window.ogb?.browser)`.
- Recent changes: the 5 history rows with `when` formatted via `niceTime`/`niceDate`.
- Search: the rail search filters `BOT_SECTIONS` by label + keywords like the app modal; when the active section is filtered out, jump to the first visible one (same effect as `SettingsModal`).
- Keyboard: Escape closes; Tab trap as in `SettingsModal`.
- [ ] Verify with `pnpm build` and the dev app; commit `feat(settings): overview reads live routines, apps, skills, and history`.

---

### Task 8: Cards say the consequence

**Files:**
- Modify: `server/routine-requests.ts` (`cardCopy` detail), `server/routine-requests.test.ts`
- Modify: the skill card copy builder and the credential card copy builder — locate with `grep -rn "stage_skill\|update_skill" server/*.ts` (skill) and `grep -rn "request_credential\|credentialRequest" server/*.ts shared/*.ts` (credential); the profile card already carries its line from step 2.

**Interfaces:**
- Routine card detail gains, before `Instructions:`, one line: for interval schedules `Will run about ${runsPerDay} times a day; each run starts a fresh session.`; for daily `Will run ${weekdays.length === 7 ? "every day" : `${weekdays.length} days a week`}; each run starts a fresh session.`; for once `Will run once; that run starts a fresh session.`. Compute `runsPerDay = Math.round(1440 / everyMinutes)` server-side (do not import the web lib).
- Skill card detail gains `Adds one line to the prompt index; the body is read only when used.`
- Credential card copy gains `Stored in the secure store. ${botName} can use it but never read it back.` where its copy is built (if the credential card has no server-side detail text, add the sentence to whatever field the web card renders as its explanation, and say where in the report).

- [ ] **Steps:** failing tests in `routine-requests.test.ts` asserting the new line for a 5-minute interval (`about 288 times a day`) and a weekday routine (`5 days a week`); implement; extend or add a test for the skill/credential copy where their tests live; `pnpm typecheck && pnpm lint && pnpm vitest run server/routine-requests.test.ts` plus the skill/credential test files; commit `feat(cards): say what happens after approval`.

---

## Done when

- `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build` green.
- Opening a bot's settings shows the centered dialog; the Overview reads correctly for a fresh bot (all six Won't lines) and for Kiwi (a 5-minute routine sentence, a skill line once one is imported).
- Every control from the old strip exists in a section and saves.
- Skills can be imported from GitHub from the Skills section.
- Proposal cards state their consequence.
