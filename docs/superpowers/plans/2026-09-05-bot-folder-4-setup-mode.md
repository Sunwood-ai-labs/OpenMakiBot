# Bot Folder, Step 4: Setup Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A blank bot, or any bot the user addresses with `/setup`, gets a setup-coach block in its system prompt that makes it interview the user briefly, state its plan, and then configure itself through the existing proposal cards; the discarded four-option onboarding quiz goes away; the Chief of Staff's `create_bot` cap rises from 1,000 to 4,000 characters.

**Architecture:** A new pure module `server/setup-mode.ts` owns the `/setup` command parser, the turn-text rewrite, the activation rule (empty `soul` and empty `description`, or a `/setup` message), and the prompt block. `startTurn` computes `setupMode` next to the soul-drift check and passes a `setup` part first in the `buildSystemPrompt` parts list, gated on the agents integration being mounted (the block names tools). The preview route includes the same part for blank bots. Room turns do not get setup mode. `createBot` stops seeding the quiz card and seeds a one-line greeting instead.

**Tech Stack:** TypeScript (Node 24), zod, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-09-05-bot-folder-and-self-setup-design.md` — Part 2 "Setup mode", "What stays manual", the Limits table row for `create_bot.instructions`, and rollout step 4.

**Depends on:** Step 2 (`propose_profile` tool) being merged first — the setup block names it. If step 2 is not yet on the branch when this plan runs, Task 1's prompt text still ships as written; the tool arrives with step 2.

## Global Constraints

- Setup mode activates when **both** `soul` and `description` are empty after trimming, **or** when the user's message is a `/setup` command. It never activates for room turns.
- The block is added only when the agents integration is mounted for the turn (`integrations.agents`), because it instructs the bot to call `propose_profile`, `propose_routine`, `skill_manage`, and `request_credential`.
- The block is inserted as the **first part after the soul section**. Existing assertions that the direct-turn prompt begins with the persona and, when a soul is set, continues with `\n\nYour standing instructions follow.` must keep passing.
- With no blank bots and no `/setup` message, every existing prompt is byte-identical to before.
- `create_bot.instructions` cap becomes **4,000 characters**, error copy `instructions must be at most 4000 characters`.
- The onboarding quiz card is no longer seeded. The greeting becomes `Hey, I'm <name>. Tell me what you want me to do and I'll set myself up.`
- Never push. Commit locally on `feat/bot-folder` only. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tests need Node 24: `export PATH=$HOME/.nvm/versions/node/v24.14.1/bin:$PATH`. `pnpm typecheck` and `pnpm lint` must pass at the end of every task.

---

## File map

- Create `server/setup-mode.ts` — `parseSetupCommand`, `expandSetupTurnText`, `setupModeActive`, `SETUP_PROMPT`, `setupSystemPrompt`.
- Create `server/setup-mode.test.ts`.
- Modify `server/index.ts` — direct-turn `startTurn`: compute `setupMode`, rewrite the turn text for `/setup`, add the `setup` part; `previewSystemPrompt`: add the part for blank bots; `POST /api/internal/create-bot`: cap.
- Modify `server/index.test.ts` — setup-block on/off tests via the fake Claude dump; `create_bot` cap test; replace the onboarding-card route test.
- Modify `server/store.ts` — `createBot` greeting; delete `onboardingCard()`.
- Modify `server/store.test.ts` — the six tests that assume the quiz card.
- Modify `src/lib/composer-commands.ts`, `src/lib/composer-commands.test.ts` — `"setup"` command id.
- Modify `src/components/Composer.tsx` — `SETUP_COMMAND` catalog entry, availability, pick behavior.

---

### Task 1: `server/setup-mode.ts` — parser, rewrite, activation rule, prompt block

**Files:**
- Create: `server/setup-mode.ts`
- Test: `server/setup-mode.test.ts`

**Interfaces:**
- Produces:
  - `parseSetupCommand(text: string): { request: string } | null`
  - `expandSetupTurnText(userText: string): string`
  - `setupModeActive(input: { soul?: string; description?: string; text: string }): boolean`
  - `SETUP_PROMPT: string` (starts with `\n\n`)
  - `setupSystemPrompt(active: boolean): string` — `SETUP_PROMPT` or `""`

- [ ] **Step 1: Write the failing tests**

Create `server/setup-mode.test.ts`:

```ts
// Setup mode: a blank bot, or a /setup message, turns on a coaching block
// that makes the bot interview the user and configure itself through cards.
import { describe, expect, it } from "vitest";

import {
  SETUP_PROMPT,
  expandSetupTurnText,
  parseSetupCommand,
  setupModeActive,
  setupSystemPrompt,
} from "./setup-mode.ts";

describe("parseSetupCommand", () => {
  it("recognises /setup with and without a request", () => {
    expect(parseSetupCommand("/setup")).toEqual({ request: "" });
    expect(parseSetupCommand("  /SETUP watch Discord and file bugs into Linear  ")).toEqual({
      request: "watch Discord and file bugs into Linear",
    });
    expect(parseSetupCommand("/setup\nevery 5 minutes")).toEqual({ request: "every 5 minutes" });
  });

  it("ignores ordinary chat that only mentions the word", () => {
    expect(parseSetupCommand("please setup a routine")).toBeNull();
    expect(parseSetupCommand("use /setup later")).toBeNull();
    expect(parseSetupCommand("/setupx")).toBeNull();
    expect(parseSetupCommand("")).toBeNull();
  });
});

describe("expandSetupTurnText", () => {
  it("turns a bare /setup into a request to set up, and keeps a described job", () => {
    expect(expandSetupTurnText("/setup")).toBe(
      "Set yourself up. Ask me what you need to know, then propose your configuration.",
    );
    expect(expandSetupTurnText("/setup watch Discord")).toBe("Set yourself up for this job: watch Discord");
    expect(expandSetupTurnText("hello")).toBe("hello");
  });
});

describe("setupModeActive", () => {
  it("is on for a blank bot regardless of the message", () => {
    expect(setupModeActive({ soul: "", description: "", text: "hello" })).toBe(true);
    expect(setupModeActive({ soul: "  \n", description: undefined, text: "hello" })).toBe(true);
    expect(setupModeActive({ text: "hello" })).toBe(true);
  });

  it("is off once either field is set, unless the message is /setup", () => {
    expect(setupModeActive({ soul: "Be brief.", description: "", text: "hello" })).toBe(false);
    expect(setupModeActive({ soul: "", description: "Files bugs.", text: "hello" })).toBe(false);
    expect(setupModeActive({ soul: "Be brief.", description: "Files bugs.", text: "/setup" })).toBe(true);
    expect(setupModeActive({ soul: "Be brief.", description: "", text: "/setup change my job" })).toBe(true);
  });
});

describe("setupSystemPrompt", () => {
  it("is the block when active and empty otherwise", () => {
    expect(setupSystemPrompt(false)).toBe("");
    expect(setupSystemPrompt(true)).toBe(SETUP_PROMPT);
    expect(SETUP_PROMPT.startsWith("\n\n")).toBe(true);
    for (const tool of ["propose_profile", "propose_routine", "skill_manage", "request_credential"]) {
      expect(SETUP_PROMPT).toContain(tool);
    }
    expect(SETUP_PROMPT).toContain("at most three questions");
    expect(SETUP_PROMPT).toContain("Wait for a yes");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run server/setup-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `server/setup-mode.ts`:

```ts
// Setup mode: the coaching block a bot gets when it has not been set up yet,
// or when the user asks for it with /setup. The bot interviews the user, says
// what it intends, and then configures itself only through proposal cards
// (propose_profile, propose_routine, skill_manage, request_credential) — so
// nothing changes without the user's approval. Mirrors skill-learn.ts:
// /setup is a turn-text rewrite plus a prompt block, never a hidden mode.

const SETUP_COMMAND = /^\/setup(?:\s+|$)([\s\S]*)$/i;

/** `/setup` at the start of a message, optionally followed by a job description. */
export function parseSetupCommand(text: string): { request: string } | null {
  const match = text.trim().match(SETUP_COMMAND);
  if (!match) return null;
  return { request: match[1]!.trim() };
}

/** What the model reads in place of a literal `/setup` message. */
export function expandSetupTurnText(userText: string): string {
  const setup = parseSetupCommand(userText);
  if (!setup) return userText;
  return setup.request
    ? `Set yourself up for this job: ${setup.request}`
    : "Set yourself up. Ask me what you need to know, then propose your configuration.";
}

/** A bot with neither standing instructions nor a description has not been
 * set up. /setup re-enters the mode for a configured bot. */
export function setupModeActive(input: { soul?: string; description?: string; text: string }): boolean {
  const blank = !(input.soul ?? "").trim() && !(input.description ?? "").trim();
  return blank || parseSetupCommand(input.text) !== null;
}

export const SETUP_PROMPT =
  "\n\nThis bot has not been set up yet, or the user asked you to set yourself up. Your job this conversation is to set yourself up from what the user tells you." +
  " First ask at most three questions that change what you would build: what the job is, when it should happen (on demand, on a schedule, or when something arrives), and which apps or accounts it touches." +
  " Then, before any tool call, tell the user in plain language what you intend: who you will be, what you will do and when, what you will need from them, and what you will not do. Wait for a yes." +
  " Then emit proposals, each of which the user must confirm: propose_profile for your identity and standing rules (keep SOUL.md short; put step-by-step procedure into a skill with skill_manage), propose_routine for anything scheduled (propose it paused), request_credential for any token." +
  " Never claim something is set up until its card is confirmed. Finish by saying what remains for the user to do by hand, such as authorizing an app or enabling a routine.";

export function setupSystemPrompt(active: boolean): string {
  return active ? SETUP_PROMPT : "";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run server/setup-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add server/setup-mode.ts server/setup-mode.test.ts
git commit -m "feat(setup): setup-mode parser, activation rule, and prompt block

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Wire setup mode into the direct turn and the preview

**Files:**
- Modify: `server/index.ts` — `startTurn` (the soul-drift block right after `const persona = [...]`, the `buildTurnContext({ text: promptWithReply(...) })` call above it, and the `buildSystemPrompt(persona, ...)` parts list), and `previewSystemPrompt`
- Test: `server/index.test.ts`

**Interfaces:**
- Consumes: `setupModeActive`, `expandSetupTurnText`, `setupSystemPrompt` from Task 1; the existing `integrations.agents`, `providerText`, `bot.soul`, `bot.description`.
- Produces: a `{ id: "setup", label: "Setup", text }` part, first in the direct-turn parts array; the same part in the preview when the bot is blank.

- [ ] **Step 1: Write the failing tests**

In `server/index.test.ts`, next to `"injects the bot's standing instructions (soul) into a real turn"`:

```ts
  it("coaches a blank bot to set itself up, and stops once it has a description", async () => {
    const bot = (await api("POST", "/api/bots", { name: "Blank" })).body.bot;
    try {
      expect((await api("PATCH", `/api/bots/${bot.id}`, {
        modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
      })).status).toBe(200);
      rmSync(fakeClaudeDump, { force: true });
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "hello" })).status).toBe(202);
      await expect.poll(() => existsSync(fakeClaudeDump), { timeout: 5_000 }).toBe(true);
      let system: string = JSON.parse(readFileSync(fakeClaudeDump, "utf8")).systemPrompt ?? "";
      expect(system.startsWith("You are Blank, a personal bot in OpenMausBot.")).toBe(true);
      expect(system).toContain("This bot has not been set up yet");
      expect(system).toContain("propose_profile");

      const preview = await api("GET", `/api/bots/${bot.id}/system-prompt`);
      expect(preview.body.sections.map((s: { id: string }) => s.id)).toContain("setup");

      await api("POST", `/api/bots/${bot.id}/interrupt`);
      expect((await api("PATCH", `/api/bots/${bot.id}`, { description: "Files bugs." })).status).toBe(200);
      rmSync(fakeClaudeDump, { force: true });
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "hello again" })).status).toBe(202);
      await expect.poll(() => existsSync(fakeClaudeDump), { timeout: 5_000 }).toBe(true);
      system = JSON.parse(readFileSync(fakeClaudeDump, "utf8")).systemPrompt ?? "";
      expect(system).not.toContain("This bot has not been set up yet");
      expect((await api("GET", `/api/bots/${bot.id}/system-prompt`)).body.sections.map((s: { id: string }) => s.id)).not.toContain("setup");
    } finally {
      await api("POST", `/api/bots/${bot.id}/interrupt`);
      await api("DELETE", `/api/bots/${bot.id}`);
    }
  });

  it("re-enters setup mode for a configured bot when the user sends /setup, and rewrites the turn text", async () => {
    const bot = (await api("POST", "/api/bots", { name: "Kiwi", description: "Files bugs." })).body.bot;
    try {
      expect((await api("PATCH", `/api/bots/${bot.id}`, {
        modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
        soul: "Never file noise.",
      })).status).toBe(200);
      rmSync(fakeClaudeDump, { force: true });
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "/setup watch Discord too" })).status).toBe(202);
      await expect.poll(() => existsSync(fakeClaudeDump), { timeout: 5_000 }).toBe(true);
      const seen = JSON.parse(readFileSync(fakeClaudeDump, "utf8"));
      const system: string = seen.systemPrompt ?? "";
      // soul first, setup block right after it
      const soulEnd = system.indexOf("--- END STANDING INSTRUCTIONS ---") + "--- END STANDING INSTRUCTIONS ---".length;
      expect(soulEnd).toBeGreaterThan(0);
      expect(system.slice(soulEnd).startsWith("\n\nThis bot has not been set up yet")).toBe(true);
      // the literal /setup never reaches the model
      const prompt: string = seen.prompt ?? seen.text ?? JSON.stringify(seen);
      expect(prompt).toContain("Set yourself up for this job: watch Discord too");
      expect(prompt).not.toMatch(/^\/setup/m);
    } finally {
      await api("POST", `/api/bots/${bot.id}/interrupt`);
      await api("DELETE", `/api/bots/${bot.id}`);
    }
  });
```

Check what field the fake Claude dump uses for the user prompt text (open `server/testing/fake-claude-cli.ts` and look at what it writes besides `systemPrompt`; the verification-skill test around `"mounts the verification skill into a real turn"` may already read it). Use that exact field name instead of the `seen.prompt ?? seen.text` guess, and delete the guess.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run server/index.test.ts -t "set itself up|re-enters setup mode"`
Expected: FAIL — no setup block in the dump; preview has no `setup` section.

- [ ] **Step 3: Compute setup mode and rewrite the turn text in `startTurn`**

Add to the imports in `server/index.ts`:

```ts
import { expandSetupTurnText, setupModeActive, setupSystemPrompt } from "./setup-mode.ts";
```

Find, in `startTurn`, the block that builds the turn context:

```ts
  const { turnText, resume } = buildTurnContext({
    text: promptWithReply(
      skillAuthoring ? expandLearnTurnText(providerText) : providerText,
```

Directly above the `const skillAuthoring =` statement that precedes it, add:

```ts
  // Setup mode: a bot with neither standing instructions nor a description
  // has not been set up; /setup re-enters the mode on purpose. Direct turns
  // only — a room message must not put every member into setup.
  const setupMode = setupModeActive({ soul: bot.soul, description: bot.description, text: providerText });
```

and change the `text:` argument so `/setup` is rewritten before the learn rewrite:

```ts
    text: promptWithReply(
      skillAuthoring ? expandLearnTurnText(expandSetupTurnText(providerText)) : expandSetupTurnText(providerText),
```

Then, in the `buildSystemPrompt(persona, store.bot(bot.id)?.soul ?? bot.soul ?? "", [` parts array of the direct turn, insert as the **first** element:

```ts
        // first after the soul: the block names agent tools, so it only goes
        // to a turn whose engine actually mounted them
        { id: "setup", label: "Setup", text: integrations.agents ? setupSystemPrompt(setupMode) : "" },
```

Do not touch the room turn.

- [ ] **Step 4: Mirror it in the preview**

In `previewSystemPrompt(bot)`, insert as the first element of its parts array:

```ts
    { id: "setup", label: "Setup", text: setupSystemPrompt(setupModeActive({ soul: bot.soul, description: bot.description, text: "" })) },
```

- [ ] **Step 5: Run the new tests and the parity suite**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run server/index.test.ts`
Expected: all green, including the pre-existing soul-injection test (its bot has a soul, so no setup block) and the whole file.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/index.test.ts
git commit -m "feat(setup): coach blank bots and /setup turns through the prompt builder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Retire the onboarding quiz seed

**Files:**
- Modify: `server/store.ts` — `onboardingCard()` (delete) and `createBot`'s seeding block
- Modify: `server/store.test.ts` — the tests listed below
- Modify: `server/index.test.ts` — `"persists an answered onboarding card"`

**Interfaces:**
- Produces: `createBot` seeds exactly one message when `seedMessages !== false`: `{ role: "bot", kind: "text", text: "Hey, I'm <name>. Tell me what you want me to do and I'll set myself up." }`. `dismissOnboardingCard` and the client-side quiz helpers stay (they handle any non-request options card and are exercised by their own fixture tests); a follow-up may remove them.

- [ ] **Step 1: Update the tests first**

In `server/store.test.ts`:

Replace the test `"createBot seeds a greeting and an onboarding card"` with:

```ts
  it("createBot seeds only a greeting that invites setup", () => {
    const store = new Store(selection);
    const bot = store.createBot();

    const messages = store.messagesFor(bot.threadId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "bot",
      kind: "text",
      text: `Hey, I'm ${bot.name}. Tell me what you want me to do and I'll set myself up.`,
    });
    expect(bot.modelSelection).toEqual(selection());
  });
```

In `"dismisses the onboarding quiz when the user talks, and leaves live asks"`, replace the first two lines of the body so the quiz is appended by the test instead of read from the seed:

```ts
    const store = new Store(selection);
    const bot = store.createBot();
    const quiz = store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "options",
      card: { title: "Quick question", subtitle: "", options: ["A", "B"] },
    });
    expect(quiz.card?.dismissed).toBeUndefined();
```

and rename it to `"dismisses an open options card when the user talks, and leaves live asks"`.

Replace `"does not dismiss the quiz for bot-authored messages"` with:

```ts
  it("does not dismiss an open options card for bot-authored messages", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const quiz = store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "options",
      card: { title: "Quick question", subtitle: "", options: ["A", "B"] },
    });
    store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "still here" });
    expect(store.messagesFor(bot.threadId).find((m) => m.id === quiz.id)?.card?.dismissed).toBeUndefined();
  });
```

In `"chains appended messages and keeps the newest as active leaf"`, change

```ts
    expect(user.parentId).toBe(messages[1].id); // follows the onboarding card
```

to

```ts
    expect(user.parentId).toBe(messages[0].id); // follows the greeting
```

In `"emits a card patch after a user message hides the onboarding quiz"`, replace `const quiz = store.messagesFor(bot.threadId)[1]!;` with the same `appendMessage` of a quiz card as above, **before** `const events = record(store);`, and rename the test to `"emits a card patch after a user message hides an open options card"`.

In `"announces a new bot before its onboarding messages"`, change the expected events to `["bot", "message"]` and rename to `"announces a new bot before its greeting"`.

In `server/index.test.ts`, replace `"persists an answered onboarding card"` with a test that no longer depends on a seeded card:

```ts
  it("a new bot opens with one greeting and no quiz card", async () => {
    const bot = (await api("POST", "/api/bots", { name: "Fresh" })).body.bot;
    try {
      expect(bot.messages).toHaveLength(1);
      expect(bot.messages[0]).toMatchObject({ role: "bot", kind: "text" });
      expect(bot.messages[0].text).toBe("Hey, I'm Fresh. Tell me what you want me to do and I'll set myself up.");
      expect(bot.messages.some((m: { kind: string }) => m.kind === "options")).toBe(false);
    } finally {
      await api("DELETE", `/api/bots/${bot.id}`);
    }
  });
```

Check whether the neighbouring test `"validates approval decisions and reports a request that is no longer open"` or any other test in that file reads `bot.messages.find((m) => m.kind === "options")` on the default bot; if so, give it its own card the way the store tests do, or point it at a real approval request. Grep: `grep -n 'kind === "options"' server/index.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run server/store.test.ts -t "greeting|options card|active leaf"`
Expected: FAIL — two messages are still seeded.

- [ ] **Step 3: Change the seed**

In `server/store.ts`, delete the `onboardingCard` const (the `(): OptionCardData => ({ title: "What do you mostly want help with?", ... })` block) and its now-unused imports if any (`OptionCardData` may still be used elsewhere in the file; keep it if so).

In `createBot`, replace the seeding block:

```ts
    if (opts.seedMessages !== false) {
      this.appendMessage(bot.threadId, {
        role: "bot",
        kind: "text",
        text: `Hey — I'm ${name}. Nice to meet you.`,
      });
      this.appendMessage(bot.threadId, { role: "bot", kind: "options", card: onboardingCard() });
    }
```

with:

```ts
    // One line, and it points at setup mode: the bot's first turn carries the
    // setup coach, so the invitation is real, not decorative.
    if (opts.seedMessages !== false) {
      this.appendMessage(bot.threadId, {
        role: "bot",
        kind: "text",
        text: `Hey, I'm ${name}. Tell me what you want me to do and I'll set myself up.`,
      });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run server/store.test.ts && pnpm vitest run server/index.test.ts -t "greeting|quiz|approval decisions"`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add server/store.ts server/store.test.ts server/index.test.ts
git commit -m "feat(setup): replace the onboarding quiz with a greeting that invites setup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `/setup` in the composer

**Files:**
- Modify: `src/lib/composer-commands.ts` (the `ComposerSlashCommandId` union), `src/lib/composer-commands.test.ts`
- Modify: `src/components/Composer.tsx` — the command constants next to `LEARN_COMMAND`, the `commandCandidates` memo, and `pickCommand`

**Interfaces:**
- Produces: `"setup"` as a `ComposerSlashCommandId`; a `/setup` entry in the slash menu for direct bot chats whose engine reports `agentsMcp`; picking it leaves `/setup ` in the composer so the literal text reaches the server (the same shape as `/learn`).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/composer-commands.test.ts` inside the `describe`:

```ts
  it("offers setup as a slash command id and keeps the typed token", () => {
    const id: ComposerSlashCommandId = "setup";
    expect(id).toBe("setup");
    expect(
      replaceComposerSlashTrigger("/se", { query: "se", start: 0, end: 3 }, "/setup "),
    ).toEqual({ text: "/setup ", caret: 7 });
  });
```

and add `type ComposerSlashCommandId,` to the import list.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm typecheck`
Expected: error — `"setup"` is not assignable to `ComposerSlashCommandId`.

- [ ] **Step 3: Add the command**

`src/lib/composer-commands.ts`:

```ts
export type ComposerSlashCommandId = "goal" | "learn" | "setup";
```

`src/components/Composer.tsx`, after `LEARN_COMMAND`:

```ts
const SETUP_COMMAND: ComposerSlashCommand = {
  id: "setup",
  label: "/setup",
  description: "Have this bot interview you and set itself up",
};
```

In `commandCandidates`, after the `LEARN_COMMAND` push:

```ts
    // Setup mode needs the agents tools (propose_profile and friends) and a
    // single bot: a room cannot set itself up.
    if (!group && supportsAgents(bot)) available.push(SETUP_COMMAND);
```

In `pickCommand`, change the replacement line to keep the token for setup as well:

```ts
    const replacement = command.id === "learn" ? "/learn " : command.id === "setup" ? "/setup " : "";
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/lib/composer-commands.test.ts src/`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/composer-commands.ts src/lib/composer-commands.test.ts src/components/Composer.tsx
git commit -m "feat(composer): /setup slash command

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Raise the `create_bot` instructions cap

**Files:**
- Modify: `server/index.ts` — `POST /api/internal/create-bot` handler (search for `instructions must be at most 1000 characters`)
- Test: `server/index.test.ts`

**Interfaces:**
- Produces: `instructions` accepted up to 4,000 characters; error copy `instructions must be at most 4000 characters`.

- [ ] **Step 1: Write the failing test**

Find the existing e2e test in `server/index.test.ts` that POSTs to `/api/internal/create-bot` (around the test that checks `201` and `section`; grep `internal/create-bot`). Add beside it, using the same headers/authentication that test uses for the internal route (copy them exactly):

```ts
  it("caps create_bot instructions at the description limit, 4000 characters", async () => {
    // reuse the Chief + headers set up by the neighbouring create-bot test
    const ok = await internal("POST", "/api/internal/create-bot", {
      name: "Cap Ok",
      role: "Specialist",
      instructions: "x".repeat(4_000),
    });
    expect(ok.status).toBe(201);
    const over = await internal("POST", "/api/internal/create-bot", {
      name: "Cap Over",
      role: "Specialist",
      instructions: "x".repeat(4_001),
    });
    expect(over).toEqual({ status: 400, body: { error: "instructions must be at most 4000 characters" } });
    await api("DELETE", `/api/bots/${ok.body.bot.id}`);
  });
```

`internal(...)` stands for whatever helper the neighbouring test uses to call the internal route (it carries the caller-bot identity headers); use that helper's real name and signature, and set up the Chief of Staff the same way that test does. If the neighbouring test creates a Chief inline, create one here too and delete it in a `finally`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/index.test.ts -t "caps create_bot"`
Expected: FAIL — the 4,000-character body is rejected with the old copy.

- [ ] **Step 3: Raise the cap**

In `server/index.ts`, change:

```ts
        if (instructions.length > 1_000) {
          return json(res, 400, { error: "instructions must be at most 1000 characters" });
        }
```

to:

```ts
        // Same ceiling as the user-editable description, which is where the
        // instructions land.
        if (instructions.length > BOT_PROFILE_LIMITS.description) {
          return json(res, 400, { error: `instructions must be at most ${BOT_PROFILE_LIMITS.description} characters` });
        }
```

(`BOT_PROFILE_LIMITS` is already imported in `server/index.ts` since step 1.)

- [ ] **Step 4: Verify and commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run server/index.test.ts -t "caps create_bot|create"
git add server/index.ts server/index.test.ts
git commit -m "feat(chief): create_bot instructions share the 4000-character description cap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- `pnpm typecheck && pnpm lint && pnpm vitest run` green.
- A fresh bot's first turn carries the setup block; a bot with a description or a soul does not; `/setup` brings it back and the model never sees the literal `/setup`.
- New bots open with one greeting and no quiz.
- The slash menu offers `/setup` on direct chats with an agents-capable engine.
- `create_bot` accepts 4,000-character instructions.
