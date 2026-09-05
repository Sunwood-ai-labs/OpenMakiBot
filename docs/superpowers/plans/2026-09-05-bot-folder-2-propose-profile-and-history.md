# Bot Folder, Step 2: `propose_profile` and the Change Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bot can propose changes to its own name, title, description, and SOUL.md through a durable confirmation card the user approves, and every accepted profile change (from the UI, the API, a card, or a SOUL.md file) is recorded in an append-only per-bot history with rollback for SOUL.md.

**Architecture:** `propose_profile` mirrors `propose_routine` end to end: an agents-proxy tool posts to `POST /api/internal/profile-requests`; a `ProfileRequestService` (same DI shape as `RoutineRequestService`) validates through `parseBotProfilePatch`, snapshots a revision token, and appends an options card carrying a `profileRequest` payload; the two `/respond` routes resolve it; approval re-checks the revision, applies through `store.patchBot` and `store.setSoul`, and records history. The history is one NDJSON file per bot in the bot folder, written with the decision-log discipline (0600, redacted, serialized, fire-and-forget). The web approval UI gains a `profileRequest` branch; phones render the card generically already.

**Tech Stack:** TypeScript (Node 24), zod, Vitest, React (static-markup tests).

**Spec:** `docs/superpowers/specs/2026-09-05-bot-folder-and-self-setup-design.md` — Part 2 "The `propose_profile` tool", Part 3 "History", "Cards say the consequence" (profile line), Data and API changes rows for `/history`, `/history/rollback`, `/api/internal/profile-requests`, and rollout step 2.

## Global Constraints

- A bot may propose changes only to **itself**; a Chief of Staff may pass `for_bot_id` for a bot in its **own section**. Anything else is 403 with a teaching error.
- Proposals accept only `name`, `title`, `description`, `soul`, plus a required `reason`. Validation is `parseBotProfilePatch(changes, true)` (same caps and error copy as the editor: `standing instructions must be at most 24000 bytes`, etc.); any other key is `unsupported profile field: <key>`.
- Approval fails closed when the target's profile changed since the card was made: `409 { error: "This bot's profile changed after this card was prepared. Ask the bot to review it and propose again." }`.
- Applying goes through the existing write paths: `store.patchBot` for name/title/description, `store.setSoul` for soul. Never write bots.json or SOUL.md any other way.
- History file: `~/.openmausbot/bots/<id>/history.ndjson`, mode `0o600`, one JSON row per changed field: `{ at: number; actor: "user" | "bot" | "file" | "import" | "system"; via: "ui" | "api" | \`card:${id}\` | "migration" | "rollback"; field: string; summary: string; before?: string; after?: string }`. `before`/`after` are full text only for `soul`; other fields carry ≤200-char one-liners. Rows pass through `redactSecrets`. Writing must never throw into the request.
- Rollback is for `soul` only, goes through `store.setSoul`, and appends its own row with `via: "rollback"`.
- The Chief's `create_bot` and the existing routine/skill card flows are untouched.
- Never push. Commit locally on `feat/bot-folder` only; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Node 24 for tests (`export PATH=$HOME/.nvm/versions/node/v24.14.1/bin:$PATH`). `pnpm typecheck` and `pnpm lint` clean at the end of every task.

---

## File map

- Create `shared/profile-request.ts` — `ProfileRequestChanges`, `ProfileRequestCardData`, `PROFILE_REQUEST_FIELDS`.
- Create `shared/line-diff.ts`, `shared/line-diff.test.ts` — small line diff for the card.
- Create `server/profile-revision.ts` — `profileRevision(bot)`, `profileSnapshot(bot)`.
- Create `server/profile-versions.ts`, `server/profile-versions.test.ts` — history append/read/rollback.
- Create `server/profile-requests.ts`, `server/profile-requests.test.ts` — the service.
- Modify `server/decision-log.ts` — add `"profile"` to `DecisionSource`.
- Modify `server/system-prompt.ts`, `server/system-prompt.test.ts` — `PROFILE_PROMPT`.
- Modify `server/bot-folder.ts`, `server/bot-folder.test.ts` — soul block copy names the tool.
- Modify `server/drivers/agents-proxy.ts`, `server/drivers/agents-proxy.test.ts` — the tool.
- Modify `server/index.ts` — internal route, resolution in both `/respond` routes, history recording in PATCH/apply-file, `/history` routes, `PROFILE_PROMPT` at three sites.
- Modify `server/index.test.ts` — integration test.
- Modify `src/state/store.tsx` — `profileRequest` on `OptionCardData`.
- Modify `src/components/ApprovalCard.tsx`, `src/components/ApprovalCard.test.ts`, `src/components/PendingApproval.tsx` — the card branch.

---

### Task 1: Shared types and the line diff

**Files:**
- Create: `shared/profile-request.ts`, `shared/line-diff.ts`
- Test: `shared/line-diff.test.ts`

**Interfaces:**
- Produces:
  - `PROFILE_REQUEST_FIELDS = ["name", "title", "description", "soul"] as const`
  - `type ProfileRequestField = (typeof PROFILE_REQUEST_FIELDS)[number]`
  - `type ProfileRequestChanges = Partial<Record<ProfileRequestField, string>>`
  - `interface ProfileRequestCardData { version: 1; requestId: string; botId: string; threadId: string; targetBotId: string; targetName: string; createdAt: number; reason: string; changes: ProfileRequestChanges; before: ProfileRequestChanges; expectedRevision: string; appliedAt?: number }`
  - `lineDiff(before: string, after: string): string[]` — unified-style lines prefixed `" "`, `"-"`, `"+"`, no headers; identical inputs → `[]`.

- [ ] **Step 1: Write the failing test**

Create `shared/line-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { lineDiff } from "./line-diff";

describe("lineDiff", () => {
  it("is empty for identical text", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual([]);
    expect(lineDiff("", "")).toEqual([]);
  });

  it("marks added, removed, and kept lines in order", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([" a", "-b", "+B", " c", "+d"]);
  });

  it("handles a fresh soul (all added) and a cleared soul (all removed)", () => {
    expect(lineDiff("", "one\ntwo")).toEqual(["+one", "+two"]);
    expect(lineDiff("one", "")).toEqual(["-one"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run shared/line-diff.test.ts`
Expected: FAIL — module not found. (Check `vite.config.ts` `test.include`: if `shared/**/*.test.ts` is not listed, add it in this task and say so in the commit.)

- [ ] **Step 3: Write the modules**

`shared/profile-request.ts`:

```ts
/**
 * Durable payload carried by a profile confirmation card (propose_profile).
 *
 * The four fields a bot may propose for itself. `before` is the snapshot the
 * user was shown; `expectedRevision` is a hash of the target's whole profile
 * at proposal time so a confirmation fails closed if anything moved.
 */
export const PROFILE_REQUEST_FIELDS = ["name", "title", "description", "soul"] as const;
export type ProfileRequestField = (typeof PROFILE_REQUEST_FIELDS)[number];
export type ProfileRequestChanges = Partial<Record<ProfileRequestField, string>>;

export interface ProfileRequestCardData {
  version: 1;
  requestId: string;
  /** The proposing conversation; authority is fixed here. */
  botId: string;
  threadId: string;
  /** Whose profile changes: the proposer, or a section peer named by a Chief. */
  targetBotId: string;
  targetName: string;
  createdAt: number;
  reason: string;
  changes: ProfileRequestChanges;
  before: ProfileRequestChanges;
  expectedRevision: string;
  appliedAt?: number;
}
```

`shared/line-diff.ts`:

```ts
/** A small line diff for approval cards: LCS over lines, output in unified
 * style without headers. Inputs are bounded by the soul cap, so quadratic
 * time over a few hundred lines is fine. */
export function lineDiff(before: string, after: string): string[] {
  if (before === after) return [];
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`-${a[i]}`);
      i++;
    } else {
      out.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out;
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
pnpm vitest run shared/line-diff.test.ts && pnpm typecheck && pnpm lint
git add shared/profile-request.ts shared/line-diff.ts shared/line-diff.test.ts vite.config.ts
git commit -m "feat(profile-request): shared card payload types and a line diff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Drop `vite.config.ts` from the add if you did not touch it.)

---

### Task 2: Revision token and the per-bot history log

**Files:**
- Create: `server/profile-revision.ts`, `server/profile-versions.ts`
- Test: `server/profile-versions.test.ts`

**Interfaces:**
- Consumes: `botFolder(botId)` from `server/bot-folder.ts`; `redactSecrets` from `server/redact.ts`; `BotRecord`.
- Produces:
  - `profileSnapshot(bot: Pick<BotRecord, "name" | "title" | "description" | "soul">): Required<ProfileRequestChanges>`
  - `profileRevision(bot: …same…): string` — sha256 hex of the JSON of the snapshot
  - `type HistoryActor = "user" | "bot" | "file" | "import" | "system"`
  - `interface HistoryRow { at: number; actor: HistoryActor; via: string; field: string; summary: string; before?: string; after?: string }`
  - `historyFile(botId): string`
  - `recordProfileChange(botId, actor, via, before: ProfileRequestChanges, after: ProfileRequestChanges): void` — one row per field whose value differs; `soul` rows carry full `before`/`after`; other rows carry `before`/`after` trimmed to 200 chars; summary like `name: "Scout" → "Kiwi"` or `soul: 0 → 312 bytes`. Fire-and-forget, serialized per file, never throws.
  - `flushProfileHistory(botId): Promise<void>` — test seam.
  - `readHistory(botId, limit = 100): HistoryRow[]` — newest first.
  - `historyRowAt(botId, at: number): HistoryRow | undefined`.

- [ ] **Step 1: Write the failing tests**

Create `server/profile-versions.test.ts`:

```ts
// Per-bot profile history: one NDJSON row per changed field, full text only
// for the soul, secrets scrubbed, and a revision token that moves when any
// of the four profile fields move.
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { profileRevision, profileSnapshot } from "./profile-revision.ts";
import {
  flushProfileHistory,
  historyFile,
  historyRowAt,
  readHistory,
  recordProfileChange,
} from "./profile-versions.ts";

const base = { name: "Scout", title: "", description: "", soul: "" };

describe("profileRevision", () => {
  it("is stable for equal profiles and moves when any field moves", () => {
    expect(profileRevision(base)).toBe(profileRevision({ ...base }));
    expect(profileRevision(base)).toMatch(/^[0-9a-f]{64}$/);
    for (const field of ["name", "title", "description", "soul"] as const) {
      expect(profileRevision({ ...base, [field]: "x" })).not.toBe(profileRevision(base));
    }
    expect(profileSnapshot({ name: "A", title: "B", description: "C", soul: undefined })).toEqual({
      name: "A", title: "B", description: "C", soul: "",
    });
  });
});

describe("profile history", () => {
  it("writes one redacted row per changed field with private mode, newest first on read", async () => {
    const id = "hist-1";
    recordProfileChange(id, "user", "ui", base, { ...base, name: "Kiwi", title: "Tracker" });
    recordProfileChange(id, "bot", "card:abc", { ...base, name: "Kiwi", title: "Tracker" }, {
      ...base, name: "Kiwi", title: "Tracker", soul: "token sk-ant-api03-SECRETSECRETSECRETSECRET\nBe brief.",
    });
    await flushProfileHistory(id);
    expect(statSync(historyFile(id)).mode & 0o777).toBe(0o600);
    const rows = readHistory(id);
    expect(rows.map((r) => r.field)).toEqual(["soul", "title", "name"]);
    expect(rows[2]).toMatchObject({ actor: "user", via: "ui", field: "name", before: "Scout", after: "Kiwi" });
    expect(rows[2]!.summary).toBe('name: "Scout" → "Kiwi"');
    expect(rows[0]).toMatchObject({ actor: "bot", via: "card:abc", field: "soul", before: "" });
    expect(rows[0]!.after).toContain("Be brief.");
    expect(rows[0]!.after).not.toContain("SECRETSECRET");
    expect(rows[0]!.summary).toMatch(/^soul: 0 → \d+ bytes$/);
    expect(historyRowAt(id, rows[0]!.at)).toEqual(rows[0]);
    expect(historyRowAt(id, 1)).toBeUndefined();
  });

  it("writes nothing when nothing changed, and trims long non-soul values", async () => {
    const id = "hist-2";
    recordProfileChange(id, "user", "api", base, { ...base });
    await flushProfileHistory(id);
    expect(existsSync(historyFile(id))).toBe(false);
    recordProfileChange(id, "user", "api", base, { ...base, description: "d".repeat(500) });
    await flushProfileHistory(id);
    const [row] = readHistory(id);
    expect(row!.after!.length).toBe(200);
    expect(readFileSync(historyFile(id), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("caps reads and survives a torn line", async () => {
    const id = "hist-3";
    for (let i = 0; i < 5; i++) recordProfileChange(id, "user", "ui", { ...base, name: `n${i}` }, { ...base, name: `n${i + 1}` });
    await flushProfileHistory(id);
    expect(readHistory(id, 2).map((r) => r.after)).toEqual(["n5", "n4"]);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(historyFile(id), '{"at":1,"acto');
    expect(readHistory(id)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/profile-versions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the modules**

`server/profile-revision.ts`:

```ts
// The revision token a profile card pins to. It covers exactly the four
// fields a bot may propose, so a confirmation fails closed if any of them
// moved between the card and the click — the profile analogue of a
// routine's expectedUpdatedAt (bots have no updatedAt of their own).
import { createHash } from "node:crypto";

import type { ProfileRequestChanges } from "../shared/profile-request.ts";

export function profileSnapshot(
  bot: { name: string; title: string; description: string; soul?: string },
): Required<ProfileRequestChanges> {
  return { name: bot.name, title: bot.title, description: bot.description, soul: bot.soul ?? "" };
}

export function profileRevision(bot: { name: string; title: string; description: string; soul?: string }): string {
  return createHash("sha256").update(JSON.stringify(profileSnapshot(bot)), "utf8").digest("hex");
}
```

`server/profile-versions.ts`:

```ts
// Per-bot profile history: an append-only NDJSON file in the bot folder,
// one row per changed field. Same discipline as decision-log.ts — 0600,
// through redactSecrets, serialized per file, fire-and-forget — because a
// history write must never fail the change it records. Full before/after
// text is kept only for the soul (so rollback is a plain write); other
// fields keep short one-liners.
import { appendFile, stat } from "node:fs/promises";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PROFILE_REQUEST_FIELDS, type ProfileRequestChanges } from "../shared/profile-request.ts";
import { botFolder } from "./bot-folder.ts";
import { redactSecrets } from "./redact.ts";

export type HistoryActor = "user" | "bot" | "file" | "import" | "system";

export interface HistoryRow {
  at: number;
  actor: HistoryActor;
  /** "ui", "api", `card:<messageId>`, "migration", "rollback" */
  via: string;
  field: string;
  summary: string;
  before?: string;
  after?: string;
}

const FILE_NAME = "history.ndjson";
const ONE_LINER = 200;
const writeQueues = new Map<string, Promise<void>>();

export function historyFile(botId: string): string {
  return join(botFolder(botId), FILE_NAME);
}

function oneLiner(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, ONE_LINER);
}

function rowFor(field: string, at: number, actor: HistoryActor, via: string, before: string, after: string): HistoryRow {
  if (field === "soul") {
    const b = Buffer.byteLength(before, "utf8");
    const a = Buffer.byteLength(after, "utf8");
    return { at, actor, via, field, summary: `soul: ${b} → ${a} bytes`, before, after };
  }
  const b = oneLiner(before);
  const a = oneLiner(after);
  return { at, actor, via, field, summary: `${field}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`, before: b, after: a };
}

async function writeRows(botId: string, rows: HistoryRow[]): Promise<void> {
  const file = historyFile(botId);
  mkdirSync(botFolder(botId), { recursive: true, mode: 0o700 });
  const text = rows.map((row) => JSON.stringify(redactSecrets(row))).join("\n") + "\n";
  await appendFile(file, text, { mode: 0o600 });
  void stat;
}

/** Record every field that differs between `before` and `after`. */
export function recordProfileChange(
  botId: string,
  actor: HistoryActor,
  via: string,
  before: ProfileRequestChanges,
  after: ProfileRequestChanges,
): void {
  const at = Date.now();
  const rows: HistoryRow[] = [];
  for (const field of PROFILE_REQUEST_FIELDS) {
    const b = before[field] ?? "";
    const a = after[field] ?? "";
    if (b !== a) rows.push(rowFor(field, at, actor, via, b, a));
  }
  if (!rows.length) return;
  const previous = writeQueues.get(botId) ?? Promise.resolve();
  const queued = previous.then(() => writeRows(botId, rows)).catch(() => {
    /* history must never take down the change it records */
  });
  writeQueues.set(botId, queued);
  void queued.finally(() => {
    if (writeQueues.get(botId) === queued) writeQueues.delete(botId);
  });
}

/** Test/shutdown seam. */
export async function flushProfileHistory(botId: string): Promise<void> {
  await writeQueues.get(botId);
}

const isRow = (value: unknown): value is HistoryRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as HistoryRow).at === "number" &&
  typeof (value as HistoryRow).field === "string" &&
  typeof (value as HistoryRow).actor === "string";

/** Newest first. Whole-file read is fine: rows are small and a bot's
 * profile does not change thousands of times. */
export function readHistory(botId: string, limit = 100): HistoryRow[] {
  let text: string;
  try {
    text = readFileSync(historyFile(botId), "utf8");
  } catch {
    return [];
  }
  const rows: HistoryRow[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRow(value)) rows.push(value);
    } catch {
      /* torn line — skip */
    }
  }
  return rows.reverse().slice(0, limit);
}

export function historyRowAt(botId: string, at: number): HistoryRow | undefined {
  return readHistory(botId, Number.MAX_SAFE_INTEGER).find((row) => row.at === at);
}
```

Remove the stray `void stat;` and the unused `stat` import if lint complains; they exist only so the file compiles if you keep the import.

Note the sort: rows written in one `recordProfileChange` call share `at`; `readHistory` reverses file order, so within one call the last field written comes first (the test's `["soul", "title", "name"]` expectation relies on `PROFILE_REQUEST_FIELDS` order and two separate calls). Keep `PROFILE_REQUEST_FIELDS` as `name, title, description, soul`.

- [ ] **Step 4: Run, typecheck, lint, commit**

```bash
pnpm vitest run server/profile-versions.test.ts && pnpm typecheck && pnpm lint
git add server/profile-revision.ts server/profile-versions.ts server/profile-versions.test.ts
git commit -m "feat(history): per-bot profile history log and revision token

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `ProfileRequestService` — propose and resolve

**Files:**
- Create: `server/profile-requests.ts`
- Test: `server/profile-requests.test.ts`
- Modify: `server/decision-log.ts` (add `"profile"` to `DecisionSource`)

**Interfaces:**
- Consumes: `parseBotProfilePatch` (`server/bot-profile.ts`), `profileRevision`/`profileSnapshot`, `recordProfileChange`, `lineDiff`, `redactSecretsInText`, `newId`, `BotRecord`.
- Produces:

```ts
export interface ProfileRequestStore {
  bot(id: string): BotRecord | undefined | null;
  messagesFor(threadId: string): Array<{ id: string; card?: OptionCardLike }>;
  appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: OptionCardLike; from?: { botId: string; name: string; color: string } }): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardLike }): { id: string } | null;
  patchBot(id: string, patch: Partial<Pick<BotRecord, "name" | "title" | "description">>): BotRecord | null;
  setSoul(id: string, soul: string): BotRecord | null;
}
export interface ProfileRequestServiceOptions {
  store: ProfileRequestStore;
  now?: () => number;
  canPersist?: (botId: string, threadId: string) => { ok: true } | { ok: false; status: number; error: string };
  /** Chief targeting another bot: returns a refusal sentence or null. Checked at propose AND confirm. */
  validateTarget?: (proposerBotId: string, targetBotId: string) => string | null;
}
export class ProfileRequestError extends Error { readonly status: number; }
export class ProfileRequestService {
  propose(args: { botId: string; threadId: string; targetBotId?: string; changes: unknown; reason: unknown; from?: {...} }): { requestId: string; messageId: string; title: string; summary: string; detail: string };
  resolve(args: { botId: string; threadId: string; requestId: string; behavior: string | undefined }): ResolveProfileRequestResult;
}
export type ResolveProfileRequestResult =
  | { claimed: false; state: "not_found" }
  | { claimed: true; state: "invalid"; error: string; status: number }
  | { claimed: true; state: "already_settled"; behavior: string }
  | { claimed: true; state: "denied" }
  | { claimed: true; state: "applied"; targetBotId: string; fields: string[] };
export function profileCardCopy(target: { name: string }, before: ProfileRequestChanges, changes: ProfileRequestChanges, reason: string): { title: string; summary: string; detail: string };
```

Card shape appended: `{ title, subtitle: detail, options: ["Confirm", "Cancel"], requestId, tool: "update_profile", profileRequest: payload }`. `OptionCardLike` is a local structural type with `requestId?`, `tool?`, `answered?`, `dismissed?`, `held?`, `profileRequest?`.

Copy rules (implement in `profileCardCopy`):
- title: `Set up ${name}?` when every `before` value is empty, else `Update ${name}'s profile?`; when a Chief targets another bot: `Update @${name}'s profile?`.
- detail lines: `Why: ${reason}`; then for each changed non-soul field `Name: "old" → "new"` (labels Name/Title/Description); then for soul: `SOUL.md (${bytesBefore} → ${bytesAfter} bytes):` followed by `lineDiff(before, after)` capped at 400 lines with a trailing `… (+N more lines)`; then the consequence line `Changes what ${name} is told on every turn. Nothing runs.`
- summary (returned to the model): `${title} · ${fields.join(", ")}`.
- All text through `redactSecretsInText` before persisting.

- [ ] **Step 1: Write the failing tests**

Create `server/profile-requests.test.ts` with an in-memory store, modeled on `server/routine-requests.test.ts` lines 20-82 (`MemoryStore`). Implement `bot()`, `patchBot()` (mutates a `Map<string, BotRecord>`), `setSoul()` (sets `soul`), `messagesFor`, `appendMessage` (pushes with `id: newId()`), `patchMessage`. Then:

```ts
describe("ProfileRequestService", () => {
  it("validates through the profile boundary, pins a revision, and appends a durable card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const result = service.propose({
      botId: bot.id, threadId: bot.threadId,
      changes: { name: "Kiwi", title: "Tracker", soul: "File bugs.\nNever noise. sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      reason: "You asked me to track Discord.",
    });
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.tool).toBe("update_profile");
    expect(card.options).toEqual(["Confirm", "Cancel"]);
    expect(card.profileRequest).toMatchObject({
      version: 1, botId: bot.id, threadId: bot.threadId, targetBotId: bot.id, targetName: "Scout",
      changes: { name: "Kiwi", title: "Tracker" }, before: { name: "Scout", title: "", soul: "" },
    });
    expect(card.profileRequest.changes.soul).not.toContain("sk-ant-api03-AAAA");
    expect(card.profileRequest.expectedRevision).toBe(profileRevision(bot));
    expect(result.title).toBe("Set up Scout?");
    expect(card.subtitle).toContain('Name: "Scout" → "Kiwi"');
    expect(card.subtitle).toContain("+File bugs.");
    expect(card.subtitle).toContain("Changes what Scout is told on every turn. Nothing runs.");
  });

  it("refuses unsupported fields, over-cap values, a missing reason, and empty changes with the boundary's copy", () => {
    const { service, bot } = harness({ name: "Scout" });
    const attempt = (changes: unknown, reason: unknown = "r") =>
      () => service.propose({ botId: bot.id, threadId: bot.threadId, changes, reason });
    expect(attempt({ notifications: false })).toThrow("unsupported profile field: notifications");
    expect(attempt({ soul: "x".repeat(24_001) })).toThrow("standing instructions must be at most 24000 bytes");
    expect(attempt({ name: "Kiwi" }, "")).toThrow("reason is required");
    expect(attempt({})).toThrow("Choose at least one of name, title, description, soul");
    expect(attempt({ name: "Scout" })).toThrow("Nothing would change");
  });

  it("applies only on confirm, through patchBot and setSoul, records history, and settles the card", async () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi", soul: "Be brief." }, reason: "r" });
    expect(store.bot(bot.id)!.name).toBe("Scout");
    const denied = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: "nope", behavior: "allow" });
    expect(denied).toEqual({ claimed: false, state: "not_found" });
    const applied = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" });
    expect(applied).toEqual({ claimed: true, state: "applied", targetBotId: bot.id, fields: ["name", "soul"] });
    expect(store.bot(bot.id)).toMatchObject({ name: "Kiwi", soul: "Be brief." });
    expect(store.setSoulCalls).toEqual([[bot.id, "Be brief."]]);
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.answered).toBe("allow");
    expect(card.profileRequest.appliedAt).toBeGreaterThan(0);
    await flushProfileHistory(bot.id);
    expect(readHistory(bot.id).map((r) => [r.field, r.actor, r.via])).toEqual([
      ["soul", "bot", `card:${store.messagesFor(bot.threadId).at(-1)!.id}`],
      ["name", "bot", `card:${store.messagesFor(bot.threadId).at(-1)!.id}`],
    ]);
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toEqual({ claimed: true, state: "already_settled", behavior: "allow" });
  });

  it("denies without changing anything, and fails closed when the profile moved after the card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const a = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: a.requestId, behavior: "deny" }))
      .toEqual({ claimed: true, state: "denied" });
    expect(store.bot(bot.id)!.title).toBe("");
    const b = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    store.patchBot(bot.id, { description: "changed elsewhere" });
    const stale = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: b.requestId, behavior: "allow" });
    expect(stale).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect((stale as { error: string }).error).toBe("This bot's profile changed after this card was prepared. Ask the bot to review it and propose again.");
    expect(store.messagesFor(bot.threadId).at(-1)!.card!.held).toContain("changed after this card");
    expect(store.bot(bot.id)!.title).toBe("");
  });

  it("pins ownership to the proposing conversation and rejects other behaviors", () => {
    const { service, bot } = harness({ name: "Scout" });
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    expect(service.resolve({ botId: "other", threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 403 });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "answer" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 400 });
  });

  it("lets a validated target be another bot, re-checks it at confirm, and applies to the target", () => {
    const { service, store, bot, addBot } = harness({ name: "Chief", chiefOfStaff: true });
    const peer = addBot({ name: "Peer" });
    let refuse: string | null = null;
    service.validateTarget = () => refuse;
    const { requestId, title } = service.propose({ botId: bot.id, threadId: bot.threadId, targetBotId: peer.id, changes: { title: "Analyst" }, reason: "r" });
    expect(title).toBe("Update @Peer's profile?");
    refuse = "@Peer is no longer in this section";
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 404 });
    refuse = null;
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ state: "applied", targetBotId: peer.id });
    expect(store.bot(peer.id)!.title).toBe("Analyst");
    expect(store.bot(bot.id)!.title).toBe("");
  });
});
```

Write the `harness()` helper: creates the memory store with one bot (fields from the arg, `id`/`threadId` random, `soul: ""`), returns `{ service, store, bot, addBot }`; `store.setSoulCalls` records calls. Import `profileRevision` from `./profile-revision.ts` and `flushProfileHistory`/`readHistory` from `./profile-versions.ts`. Make `validateTarget` a public mutable property on the service so the test can flip it (declare it `validateTarget?: (...) => string | null;` as a public field set from options).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/profile-requests.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `server/profile-requests.ts` implementing the interfaces above. Structure (follow `routine-requests.ts` for style; keep it under ~300 lines):

```ts
// propose_profile: a bot proposes changes to its own name, title, description,
// or SOUL.md; the change lands only when the user confirms the card. Same
// shape as routine-requests.ts, much smaller: the apply step is two existing
// store calls, and staleness is a hash of the four fields instead of a
// scheduler revision. Everything here is re-validated at confirm time —
// a card can sit open for days.
import { z } from "zod";

import { lineDiff } from "../shared/line-diff.ts";
import { PROFILE_REQUEST_FIELDS, type ProfileRequestCardData, type ProfileRequestChanges } from "../shared/profile-request.ts";
import { parseBotProfilePatch } from "./bot-profile.ts";
import { newId } from "./contracts.ts";
import { profileRevision, profileSnapshot } from "./profile-revision.ts";
import { recordProfileChange } from "./profile-versions.ts";
import { redactSecretsInText } from "./redact.ts";
import type { BotRecord } from "./store.ts";

const MAX_REASON = 500;
const MAX_DIFF_LINES = 400;
const STALE = "This bot's profile changed after this card was prepared. Ask the bot to review it and propose again.";
const LABELS: Record<Exclude<(typeof PROFILE_REQUEST_FIELDS)[number], "soul">, string> = { name: "Name", title: "Title", description: "Description" };
```

`propose`:
1. `reason`: must be a non-empty string after trim (`"reason is required"`), ≤ `MAX_REASON`, redacted.
2. `changes`: must be a plain object; any key outside `PROFILE_REQUEST_FIELDS` → `unsupported profile field: <key>` (check this yourself before calling the parser so the copy is exact for keys the strict parser would accept, like `notifications`); empty → `"Choose at least one of name, title, description, soul"`; then `parseBotProfilePatch(changes, true)`; on failure throw `ProfileRequestError(error, 400)`. Redact every string value.
3. Resolve target: `targetBotId ?? botId`; `store.bot(target)` must exist (`404 "That bot no longer exists"`); when target ≠ proposer and `validateTarget` returns a sentence → `403`.
4. `before = profileSnapshot(target)` restricted to the changed keys; drop any change equal to its before value; if none remain → `"Nothing would change"`.
5. `payload = { version: 1, requestId: newId(), botId, threadId, targetBotId, targetName: target.name, createdAt: now(), reason, changes, before, expectedRevision: profileRevision(target) }`.
6. `copy = profileCardCopy(target, before, changes, reason)`; `canPersist` check; `appendMessage` with the card; return `{ requestId, messageId, title, summary, detail }`.

`resolve`: mirror `RoutineRequestService.resolve` minus receipts: find the message by `requestId` with `card.profileRequest`; behavior must be `allow`/`deny` else `invalid 400 "Profile confirmations must be confirmed or cancelled"`; ownership check (`payload.botId === args.botId && payload.threadId === args.threadId`) else `invalid 403 "This profile request belongs to another conversation"`; `card.answered` → `already_settled`; `deny` → patch `answered: "deny"`, return `denied`; `allow` → re-resolve target (`404` if gone), `validateTarget` again when target ≠ proposer (`404` with its sentence), `profileRevision(target) === payload.expectedRevision` else `409 STALE`; apply: `const { soul, ...rest } = payload.changes; if (Object.keys(rest).length) store.patchBot(target.id, rest); if (soul !== undefined) store.setSoul(target.id, soul);` then `recordProfileChange(target.id, "bot", \`card:${message.id}\`, payload.before, payload.changes)`; patch the card `{ ...card, answered: "allow", held: undefined, profileRequest: { ...payload, appliedAt: now() } }`; return `applied` with `fields` in `PROFILE_REQUEST_FIELDS` order. Any thrown `ProfileRequestError` inside `allow` → patch `held` (redacted, ≤500 chars) and return `invalid` with its status.

`profileCardCopy` as specified in Interfaces.

Also in `server/decision-log.ts`, add `| "profile"` to the `DecisionSource` union.

- [ ] **Step 4: Run, typecheck, lint, commit**

```bash
pnpm vitest run server/profile-requests.test.ts shared/line-diff.test.ts && pnpm typecheck && pnpm lint
git add server/profile-requests.ts server/profile-requests.test.ts server/decision-log.ts
git commit -m "feat(profile-request): service that stages and applies profile cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The prompt sentences

**Files:**
- Modify: `server/system-prompt.ts`, `server/system-prompt.test.ts`
- Modify: `server/bot-folder.ts` (`soulSystemPrompt` copy), `server/bot-folder.test.ts`

**Interfaces:**
- Produces: `PROFILE_PROMPT` (leading single space, like its siblings):

```ts
export const PROFILE_PROMPT =
  " If the user asks you to change who you are — your name, title, description, or standing instructions (SOUL.md) — or to set yourself up, use propose_profile. It only creates a confirmation card; nothing changes until the user confirms it, so never claim your profile changed before that confirmation.";
```

and the soul block's second sentence changes from `The user manages them in SOUL.md; you cannot edit them yourself.` to `The user manages them in SOUL.md; you may propose changes with propose_profile, which apply only after the user confirms.`

- [ ] **Step 1: Update the tests**

In `server/system-prompt.test.ts`, add `PROFILE_PROMPT` to the import and to the `for (const sentence of [...])` loop in `"each begins with one space…"`, and add:

```ts
  it("PROFILE_PROMPT names the tool and the confirmation rule", () => {
    expect(PROFILE_PROMPT).toContain("propose_profile");
    expect(PROFILE_PROMPT).toContain("nothing changes until the user confirms");
  });
```

In `server/bot-folder.test.ts`, change the assertion `expect(block).toContain("you cannot edit them yourself");` to `expect(block).toContain("propose changes with propose_profile");`.

- [ ] **Step 2: Run to verify failure, then implement**

Run: `pnpm vitest run server/system-prompt.test.ts server/bot-folder.test.ts` → FAIL. Add the constant and change the sentence in `soulSystemPrompt`. Run again → PASS.

- [ ] **Step 3: Check the index.test assertion still holds**

`server/index.test.ts` asserts the soul block starts with `"\n\nYour standing instructions follow."` — unchanged by this edit. Also `server/skill-library.test.ts` asserts skill instructions do not contain `propose_routine`; nothing here touches it.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add server/system-prompt.ts server/system-prompt.test.ts server/bot-folder.ts server/bot-folder.test.ts
git commit -m "feat(prompt): tell bots about propose_profile

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The `propose_profile` tool in the agents proxy

**Files:**
- Modify: `server/drivers/agents-proxy.ts` — `TOOLS` (after `propose_routine_action`), `callTool` (after the `propose_routine_action` branch)
- Test: `server/drivers/agents-proxy.test.ts`

**Interfaces:**
- Produces the tool:

```ts
  {
    name: "propose_profile",
    description:
      "Propose changes to your own name, title, description, or standing instructions (SOUL.md). This only creates a confirmation card; nothing changes until the user approves it. After calling it, end the turn and do not claim the change is applied. Keep SOUL.md short — who you are and the rules you never break; put step-by-step procedure into a skill instead. A Chief of Staff may pass for_bot_id (from list_bots) to propose a change for another bot in its section.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", maxLength: 100, description: "New display name." },
        title: { type: "string", maxLength: 200, description: "New role or title." },
        description: { type: "string", maxLength: 4000, description: "New one-line blurb shown in rosters." },
        soul: { type: "string", description: "Full replacement text for SOUL.md, at most 24000 bytes." },
        reason: { type: "string", minLength: 1, maxLength: 500, description: "One sentence the user will see explaining why." },
        for_bot_id: { type: "string", description: "Chief of Staff only: the id of another bot in your section whose profile this changes. Omit to change your own." },
      },
      required: ["reason"],
    },
  },
```

- Handler: build `changes` from whichever of `name`/`title`/`description`/`soul` are strings (untrimmed for `soul`, trimmed for the others); if none → `{ text: "propose_profile needs at least one of name, title, description, or soul.", isError: true }`; POST `/api/internal/profile-requests` with `{ fromBotId: BOT_ID, fromThreadId: THREAD_ID, changes, reason, forBotId: for_bot_id || undefined }`; return `confirmationResult(r, "the profile change")` but with the closing sentence adapted: reuse `confirmationResult` as is (its text says "do not claim the routine was created or changed" — change `confirmationResult` to take the noun: add a third parameter `noun = "routine"` and use `` `do not claim the ${noun} was created or changed before confirmation` ``; pass `"profile"` here and leave routine callers unchanged).

- [ ] **Step 1: Write the failing tests**

In `server/drivers/agents-proxy.test.ts`, find the tool-list assertion (around line 250) and add `"propose_profile"` to the expected list. Find a `callTool("propose_routine", …)` test that asserts the POST body (around line 609) and add beside it:

```ts
  it("propose_profile posts the changed fields and reason to the internal route", async () => {
    const calls = captureInternalPosts(); // reuse this file's helper that records fetch calls; use its real name
    const result = await callTool("propose_profile", { name: " Kiwi ", soul: "Be brief.\n", reason: "asked" });
    expect(calls.at(-1)).toMatchObject({
      path: "/api/internal/profile-requests",
      body: { fromBotId: expect.any(String), fromThreadId: expect.any(String), changes: { name: "Kiwi", soul: "Be brief.\n" }, reason: "asked" },
    });
    expect(result.text).toContain("confirmation card is now visible");
    expect(result.text).toContain("do not claim the profile was created or changed");
  });

  it("propose_profile refuses an empty change set without calling the harness", async () => {
    const result = await callTool("propose_profile", { reason: "asked" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("needs at least one of name, title, description, or soul");
  });
```

Adapt `captureInternalPosts()` to whatever this test file already does to stub `fetch`/the harness (read lines 560-640 for the `propose_routine` tests and copy their mechanism exactly).

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `pnpm vitest run server/drivers/agents-proxy.test.ts` → FAIL (unknown tool). Implement per Interfaces. → PASS. Also check `server/peer-roster.test.ts` and `server/peer-allowlist.e2e.test.ts` for tool-list assertions that enumerate every tool; update them if they do.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add server/drivers/agents-proxy.ts server/drivers/agents-proxy.test.ts server/peer-roster.test.ts server/peer-allowlist.e2e.test.ts
git commit -m "feat(agents): propose_profile tool

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Drop files you did not change from the add.)

---

### Task 6: Routes — internal proposal, resolution, history, and recording every profile change

**Files:**
- Modify: `server/index.ts` — imports; a `profileRequests` service instance next to `routineRequests`; `POST /api/internal/profile-requests` next to `/api/internal/routine-requests`; a `resolveAndSendProfile` next to `resolveAndSendRoutine` and calls to it in both `/respond` routes; `recordProfileChange` in the two PATCH routes and the `apply-file` route; `GET /api/bots/:id/history`, `POST /api/bots/:id/history/rollback`; `PROFILE_PROMPT` at the three routine-prompt sites; `deleteBot` cleanup is already folder-wide.
- Test: `server/index.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/internal/profile-requests` body `{ fromBotId, fromThreadId, forBotId?, changes, reason }` → `201 { requestId, messageId, title, summary, detail }`; errors as the service throws (`400`/`403`/`404`/`429`).
  - Resolution via `POST /api/threads/:threadId/respond` and `POST /api/bots/:id/respond` with `{ requestId, behavior: "allow" | "deny" }`, same response shapes as routines (`{ ok: true, outcome: "allowed-once", profileFields: [...] }` on apply).
  - `GET /api/bots/:id/history?limit=` → `{ rows: HistoryRow[] }` newest first (default 100, max 500).
  - `POST /api/bots/:id/history/rollback` body `{ at: number }` → `{ bot }`; `400` unless the row exists, is `field: "soul"`, and has `before`; applies `store.setSoul(id, row.before)` and records `via: "rollback"`, `actor: "user"`.
  - Every profile change through `PATCH /api/bots/:id` (via `"api"`… see below), `PATCH /api/bots/:id/profile` (via `"api"`), and `POST …/soul/apply-file` (actor `"file"`, via `"ui"`) records history. The web UI and curl both hit the broad PATCH; record them as `actor: "user", via: "api"` (the UI is an API client; distinguishing them is not worth a header).

- [ ] **Step 1: Write the failing integration test**

Add to `server/index.test.ts` next to `"keeps chat-created routines inert until their durable card is confirmed"`, reusing its token-extraction mechanism verbatim (send a message to a Claude-fixture bot, read `fakeClaudeDump`'s `mcpConfig.mcpServers.agents.env.OMB_COMMS_TOKEN`, interrupt):

```ts
  it("keeps a proposed profile change inert until its card is confirmed, then records history", async () => {
    const bot = (await api("POST", "/api/bots", { name: "Scout" })).body.bot;
    try {
      await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
      // … obtain `token` and `internalHeaders` exactly as the routine test does …
      const proposal = await fetch(`${BASE}/api/internal/profile-requests`, {
        method: "POST", headers: internalHeaders,
        body: JSON.stringify({ fromBotId: bot.id, fromThreadId: bot.threadId, changes: { name: "Kiwi", soul: "Be brief." }, reason: "you asked" }),
      });
      expect(proposal.status).toBe(201);
      const proposed = await proposal.json();
      const card = (await api("GET", `/api/bots/${bot.id}`)).body.bot?.messages?.find((m: any) => m.card?.requestId === proposed.requestId)
        ?? (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === bot.id).messages.find((m: any) => m.card?.requestId === proposed.requestId);
      expect(card.card).toMatchObject({ tool: "update_profile", profileRequest: { botId: bot.id, targetBotId: bot.id } });
      expect((await api("GET", `/api/bots/${bot.id}/soul`)).body.soul).toBe("");

      // a stale confirm fails closed
      await api("PATCH", `/api/bots/${bot.id}`, { title: "moved" });
      const stale = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: proposed.requestId, behavior: "allow" });
      expect(stale.status).toBe(409);

      // propose again and confirm
      const again = await (await fetch(`${BASE}/api/internal/profile-requests`, {
        method: "POST", headers: internalHeaders,
        body: JSON.stringify({ fromBotId: bot.id, fromThreadId: bot.threadId, changes: { name: "Kiwi", soul: "Be brief." }, reason: "you asked" }),
      })).json();
      const ok = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: again.requestId, behavior: "allow" });
      expect(ok.body).toMatchObject({ ok: true, outcome: "allowed-once", profileFields: ["name", "soul"] });
      const after = (await api("GET", `/api/bots/${bot.id}/soul`)).body;
      expect(after.soul).toBe("Be brief.");
      expect(readFileSync(soulFileOf(bot.id), "utf8")).toBe("Be brief.");

      const history = await api("GET", `/api/bots/${bot.id}/history`);
      expect(history.status).toBe(200);
      const fields = history.body.rows.map((r: any) => `${r.field}:${r.actor}:${r.via.split(":")[0]}`);
      expect(fields.slice(0, 2).sort()).toEqual(["name:bot:card", "soul:bot:card"]);
      expect(fields).toContain("title:user:api");

      // rollback the soul
      const soulRow = history.body.rows.find((r: any) => r.field === "soul");
      const rolled = await api("POST", `/api/bots/${bot.id}/history/rollback`, { at: soulRow.at });
      expect(rolled.status).toBe(200);
      expect(rolled.body.bot.soul).toBe("");
      expect((await api("GET", `/api/bots/${bot.id}/history`)).body.rows[0]).toMatchObject({ field: "soul", via: "rollback", actor: "user" });
      expect((await api("POST", `/api/bots/${bot.id}/history/rollback`, { at: 1 })).status).toBe(400);

      // decisions audit
      await expect.poll(async () => {
        const decisions = (await api("GET", "/api/decisions")).body.decisions;
        return decisions.filter((d: any) => d.requestId === again.requestId).map((d: any) => `${d.decision}:${d.source}`).sort();
      }).toEqual(["card-shown:profile", "user-approved:user"]);
    } finally {
      await api("POST", `/api/bots/${bot.id}/interrupt`);
      await api("DELETE", `/api/bots/${bot.id}`);
    }
  });
```

Replace the awkward `card` lookup with whatever the routine test does to find the card (it reads `GET /api/bots` and finds the message); copy that. `soulFileOf` exists from step 1.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/index.test.ts -t "proposed profile change"` → FAIL (404 on the internal route).

- [ ] **Step 3: Implement the routes**

Imports:

```ts
import { ProfileRequestService } from "./profile-requests.ts";
import { profileSnapshot } from "./profile-revision.ts";
import { historyRowAt, readHistory, recordProfileChange } from "./profile-versions.ts";
import { PROFILE_PROMPT, … } from "./system-prompt.ts";
```

Service, next to `const routineRequests = new RoutineRequestService({…})`:

```ts
const profileRequests = new ProfileRequestService({
  store,
  canPersist: routineProposalPersistence,
  // A Chief may change a section peer; anyone else only itself. Re-checked at confirm.
  validateTarget: (proposerBotId, targetBotId) => {
    const proposer = store.bot(proposerBotId);
    const target = store.bot(targetBotId);
    if (!target) return "that bot no longer exists";
    if (!proposer?.chiefOfStaff) return "only a section's Chief of Staff can change another bot's profile";
    if (sectionKey(target.section) !== sectionKey(proposer.section)) return "that bot belongs to a different section";
    return null;
  },
});
```

`routineProposalPersistence` counts open `routineRequest` cards; generalize it to count open cards with `routineRequest || profileRequest` (rename to `proposalPersistence` if you like, update the routine call site) so one thread cannot pile up 8 of each.

Internal route, directly after the `/api/internal/routine-requests` block:

```ts
      if (method === "POST" && path === "/api/internal/profile-requests") {
        const parsed = z.object({
          fromBotId: z.string().min(1).max(128),
          fromThreadId: z.string().min(1).max(128),
          forBotId: z.string().max(128).optional(),
          changes: z.unknown(),
          reason: z.unknown(),
        }).strict().safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: "invalid profile proposal" });
        const body = parsed.data;
        const from = store.bot(body.fromBotId);
        if (!from) return json(res, 403, { error: "unknown sender" });
        const owner = connectorThread(from.id, body.fromThreadId);
        if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
        const targetBotId = body.forBotId?.trim() || from.id;
        const proposed = profileRequests.propose({
          botId: from.id,
          threadId: body.fromThreadId,
          targetBotId,
          changes: body.changes,
          reason: body.reason,
          from: owner.group ? { botId: from.id, name: from.name, color: from.color } : undefined,
        });
        appendDecision(DATA_DIR, {
          threadId: body.fromThreadId, requestId: proposed.requestId, botId: from.id, botName: from.name,
          tool: "update_profile", summary: proposed.detail, decision: "card-shown", source: "profile",
        });
        return json(res, 201, proposed);
      }
```

Confirm how `RoutineRequestError` thrown from the routine route becomes an HTTP status (the outer try/catch reads `.status`); make `ProfileRequestError` behave identically (same property name, and add it to whatever `instanceof` check that catch performs, if it has one).

Resolution helper, next to `resolveAndSendRoutine`:

```ts
function resolveAndSendProfile(
  res: ServerResponse,
  args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string },
): boolean {
  const card = store.messagesFor(args.threadId).find(
    (message) => message.card?.requestId === args.requestId && message.card.profileRequest,
  )?.card;
  if (!card) return false;
  const result = profileRequests.resolve(args);
  if (!result.claimed) return false;
  if (result.state === "applied" || result.state === "denied") {
    appendDecision(DATA_DIR, {
      threadId: args.threadId, requestId: args.requestId, botId: args.botId, botName: args.botName,
      tool: "update_profile", summary: card.subtitle,
      decision: result.state === "applied" ? "user-approved" : "user-denied", source: "user",
    });
  }
  if (result.state === "applied") {
    const target = store.bot(result.targetBotId);
    if (target) broadcast({ kind: "bot", bot: wireBot(target) });
    json(res, 200, { ok: true, outcome: "allowed-once", profileFields: result.fields });
    return true;
  }
  if (result.state === "invalid") { json(res, result.status, { error: result.error }); return true; }
  if (result.state === "already_settled") {
    json(res, 200, { ok: true, outcome: result.behavior === "allow" ? "allowed-once" : "rejected", alreadySettled: true });
    return true;
  }
  json(res, 200, { ok: true, outcome: "rejected" });
  return true;
}
```

Call it in both `/respond` routes immediately after the routine intercept, with the same owner-derivation logic the routine branch uses (for the thread route: find the card by `requestId` with `card.profileRequest`, derive `botId` from `card.from?.botId ?? store.botByThread(threadId)?.id`).

History recording. In the broad `PATCH /api/bots/:id` handler, capture `const beforeProfile = existingBot ? profileSnapshot(existingBot) : undefined;` near the top (where `existingBot` is read) and, after the final `store.patchBot` / `setSoul` and before the response, `if (beforeProfile) { const now = store.bot(bot.id)!; recordProfileChange(bot.id, "user", "api", beforeProfile, profileSnapshot(now)); }`. Same in `PATCH /api/bots/:id/profile`. In `apply-file`: `recordProfileChange(bot.id, "file", "ui", profileSnapshot(bot), profileSnapshot(updated))`.

History routes, next to the soul routes:

```ts
    m = path.match(/^\/api\/bots\/([\w-]+)\/history$/);
    if (m && method === "GET") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      return json(res, 200, { rows: readHistory(m[1], limit) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/history\/rollback$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const at = Number(body?.at);
      const row = Number.isFinite(at) ? historyRowAt(bot.id, at) : undefined;
      if (!row || row.field !== "soul" || typeof row.before !== "string") {
        return json(res, 400, { error: "rollback is available for SOUL.md entries only" });
      }
      const parsed = parseBotProfilePatch({ soul: row.before });
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      const before = profileSnapshot(bot);
      const updated = store.setSoul(bot.id, parsed.patch.soul ?? "");
      if (!updated) return json(res, 404, { error: "no such bot" });
      recordProfileChange(bot.id, "user", "rollback", before, profileSnapshot(updated));
      const visible = wireBot(updated);
      broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }
```

Prompt sites: add `{ id: "profile", label: "Profile changes", text: integrations.agents ? PROFILE_PROMPT : "" }` directly after the `routine` part in the direct turn; `{ id: "profile", label: "Profile changes", text: PROFILE_PROMPT }` after `routine` in `previewSystemPrompt`; `integrations.agents && PROFILE_PROMPT.trim(),` after the routine sentence in the room `system` array.

- [ ] **Step 4: Run, then the whole file**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run server/index.test.ts
```
Expected: green. If the soul-injection or parity tests complain about the new `profile` part, the part must come after `routine` and be gated exactly like it.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/index.test.ts
git commit -m "feat(api): propose_profile route, card resolution, profile history and rollback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Web — the profile card in chat

**Files:**
- Modify: `src/state/store.tsx` — `OptionCardData`
- Modify: `src/components/ApprovalCard.tsx`, `src/components/PendingApproval.tsx`
- Test: `src/components/ApprovalCard.test.ts`

**Interfaces:**
- Produces: `OptionCardData.profileRequest?: ProfileRequestCardData` (import the type from `../../shared/profile-request`); ApprovalCard treats a card with `profileRequest` like a routine card: header `"<bot> wants to update its profile"`, tool chip `update_profile`, `subtitle` in the `<pre>` (label it `aria-label="Profile change"`), settled label `Profile updated`; PendingApproval offers Confirm/Cancel with no "Always allow" and no "Cancel turn" (durable), and its voice/strip copy says `wants to update its profile`.

- [ ] **Step 1: Write the failing test**

In `src/components/ApprovalCard.test.ts`, next to the routine tests:

```ts
describe("ApprovalCard profile proposals", () => {
  const card = (answered?: string) => ({
    title: "Set up Scout?",
    subtitle: 'Why: you asked\nName: "Scout" → "Kiwi"\nSOUL.md (0 → 9 bytes):\n+Be brief.\nChanges what Scout is told on every turn. Nothing runs.',
    options: ["Confirm", "Cancel"],
    requestId: "req-p1",
    tool: "update_profile",
    answered,
    profileRequest: {
      version: 1 as const, requestId: "req-p1", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
      createdAt: 1, reason: "you asked", changes: { name: "Kiwi", soul: "Be brief." }, before: { name: "Scout", soul: "" }, expectedRevision: "r",
    },
  });

  it("describes a profile proposal as a profile update and shows the diff", () => {
    const html = renderCard(card()); // use this file's existing render helper name
    expect(html).toContain("wants to update its profile");
    expect(html).toContain("update_profile");
    expect(html).toContain("+Be brief.");
    expect(html).toContain("Nothing runs.");
  });

  it("records Profile updated after confirmation", () => {
    expect(renderCard(card("allow"))).toContain("Profile updated");
  });
});
```

- [ ] **Step 2: Run to verify failure, implement, run again**

`pnpm vitest run src/components/ApprovalCard.test.ts` → FAIL. Then:

`src/state/store.tsx`: add `profileRequest?: ProfileRequestCardData;` to `OptionCardData` with the import.

`ApprovalCard.tsx`: add `update_profile: "update its profile"` to `toolLabel`'s map; add `const isProfileRequest = Boolean(card.profileRequest);` and make `displayTool = isRoutineRequest ? … : isSkillRequest ? … : isProfileRequest ? "update_profile" : card.tool`; settled label `"Profile updated"` when `isProfileRequest && card.answered === "allow"` (follow how `routineSettledLabel` is used); the `<pre>` gets `aria-label={isProfileRequest ? "Profile change" : …}`.

`PendingApproval.tsx`: add `export function isProfileApproval(pending) { return Boolean(pending.message.card?.profileRequest); }`; include it wherever `isRoutineApproval` decides `durableRequest`, the Confirm/Cancel labels, the tool chip, and the spoken/strip copy (`wants to update its profile`).

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run src/
git add src/state/store.tsx src/components/ApprovalCard.tsx src/components/ApprovalCard.test.ts src/components/PendingApproval.tsx
git commit -m "feat(web): render and answer propose_profile cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- `pnpm typecheck && pnpm lint && pnpm vitest run` green.
- Against the fixture: a Claude-fixture bot's tool list includes `propose_profile`; posting a proposal yields a card; Confirm applies name/title/description/soul through the normal paths and writes history rows; a stale confirm 409s; `GET /history` lists rows newest first; rollback restores the previous soul and logs it.
- Phones still render the card generically (title, detail, Confirm/Cancel) with no code change.
