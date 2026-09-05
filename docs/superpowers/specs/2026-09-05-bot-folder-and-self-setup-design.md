# The bot is a folder: long instructions, self-setup, and a settings dialog you can read

A bot's persona stops being a 4,000-character string and becomes a small folder
the user can read: `SOUL.md` for who it is, `skills/*.md` for how it does
things, `MEMORY.md` for what it has learned, plus its routines and access. A new
bot can write that folder itself from a conversation, one confirmation card at a
time. And a bot's settings move out of the right-hand strip into a centered
dialog whose first page says, in plain language, what the bot will and will not
do.

## Problem

Three complaints, one cause.

**"4,000 characters is not enough."** The persona is `BotRecord.description`,
capped by `BOT_PROFILE_LIMITS.description` in `shared/bot-profile.ts` and
enforced by zod in `server/bot-profile.ts:33`. The web textarea uses HTML
`maxLength`, so typing just stops, with no counter and no error. The cap is
also out of step with everything around it:

| Text that reaches the prompt | Cap today |
|---|---|
| `description` (user-edited persona) | 4,000 chars |
| `create_bot` instructions (Chief of Staff) | 1,000 chars |
| One installed package playbook | 24,000 chars |
| `MEMORY.md`, inlined every turn | 24,000 bytes |

The cap exists because `description` is inlined on every turn. That is a real
cost, but the cap is the wrong tool for it. The Kiwi bot is the case study: its
persona sits at 3,385 chars and its judgment had to be split by hand into a
4,885-char `PLAYBOOK.md` that the bot reads at runtime. That split is the right
design. Users are doing it manually because the product does not offer it.

**"Setting up a bot is a hassle."** Creating a bot is one click that POSTs an
empty body (`src/state/store.tsx:1667`). Making it useful means a random name,
an empty title and description, a 4-option quiz whose answer is discarded
(`server/store.ts:607`), and then about twenty unordered controls in a
1,000-line right-hand panel (`src/components/SettingsPanel.tsx:538-1036`), with
connected apps and MCP servers in a different modal. There is no per-bot
template. Meanwhile the bot itself already has `propose_routine`,
`propose_routine_action`, `skill_manage`, and `request_credential`, each staging
a card the user approves. The one thing it cannot do is write its own persona.

**"I can't see what it will do."** Nothing renders the bot as a whole. The
effective system prompt is assembled inline in `server/index.ts:3373-3412` and
never shown. Absent toggles are silent, so "no connected apps" and "won't run
commands without asking" are invisible facts. Cards say what changes, not what
happens afterwards. There is no history of who changed what.

## What we are building

1. **A bot folder.** `SOUL.md` joins `MEMORY.md` and `skills/` as the third
   per-bot file. Persona text is tiered by how often it is loaded, and the
   4,000 cap stops mattering because standing instructions live in `SOUL.md`
   and procedures live in on-demand skills.
2. **Self-setup.** A `propose_profile` tool and a setup-mode prompt block. A
   blank bot interviews the user briefly, says what it intends in plain
   language, then emits cards: profile, routines, credentials, skills. Nothing
   is applied without a card.
3. **A bot settings dialog.** A centered dialog with a section rail, like the
   app-level Settings modal, replacing the right-hand strip. Its first page is
   an overview generated from the folder: what the bot is, does, can reach,
   and will not do. It includes the exact system prompt the model will see and
   a per-bot change log.

### Not in scope

- Bundling every setup card into one "setup plan" card. v1 emits sequential
  cards, each with a consequence line. A bundled card is a follow-up.
- Folding installed package playbooks and the bundled skill library into
  per-bot skills. Noted as the intended direction; not done here.
- Per-bot MCP server grants. Still owned by the MCP registry plan.
- Rollback of anything other than `SOUL.md`.
- Doing external OAuth or third-party app creation for the user. The bot walks
  the user through it and asks for the token via `request_credential`.

## Part 1: the bot folder

### Layout

```
~/.openmausbot/bots/<id>/           server-owned. Bot reads; writes only via card.
  SOUL.md                           identity + standing rules. Always in prompt.
  skills/<name>/SKILL.md            procedures. Index in prompt, body on demand.
                                    (physically still ~/.openmausbot/skill-state/<id>/;
                                     the folder view symlinks it, as the workspace does today)

~/.openmausbot/workspaces/<id>/     bot-writable cwd. Exists today, unchanged.
  MEMORY.md, memory/*.md            learned facts. Inlined; bot edits freely.
  skills/                           symlinks, as today.
```

`description` stays on `BotRecord` and keeps its 4,000 cap, so the iOS and
Android profile contract does not change. Its role narrows to the one-line
blurb that the roster, the phone apps, and the bot directory clip to anyway.
The Identity section of the dialog hints at 200 characters; the cap is not
lowered.

### Canonical store and the file mirror

`SOUL.md` is a projection, not the source of truth. The canonical text is a
new `soul: string` field on `BotRecord` in `bots.json`, with `soulHash`
(sha256) beside it. The server rewrites `bots/<id>/SOUL.md` from `soul` after
every accepted change. The prompt is built from `soul`, never from the file.

This is the security rule and it is deliberate. Kiwi reads untrusted Discord
messages. A prompt injection that could rewrite the persona file would persist
into every future run. The codebase already draws this line: section context
is unwritable by agents (`server/section-context.ts:3-6`), skills are staged
outside the workspace and confirmed by card, and only memory is free-write.
`SOUL.md` follows the skills rule.

**Out-of-band edits.** At each turn dispatch the server hashes the mirror. If it
differs from `soulHash`, the turn proceeds with the canonical `soul`, the bot
is marked `soulDrift: true`, and the Overview and Soul sections show a banner
with a diff and two buttons: **Apply** (runs the file text through the same
validation as a user edit, logs it as `actor: "file"`) or **Discard** (rewrites
the mirror). The bot is never told the file changed. A user editing `SOUL.md`
in their editor is a first-class path; a bot doing it is not.

### Limits

| Field | Cap | Where |
|---|---|---|
| `soul` | 24,000 bytes | `BOT_PROFILE_LIMITS.soul`, same constant file as today |
| `description` | 4,000 chars | unchanged |
| `create_bot.instructions` | 4,000 chars | raised from 1,000; lands in `description` as today |

The cap on `soul` matches `MEMORY_MAX_BYTES`. It is a cost guard, not a design
target. Setup mode keeps `SOUL.md` short and moves procedure into skills, and
the "What the model sees" page shows the per-turn byte cost so the user can
judge for themselves.

### Prompt assembly

The inline assembly in `server/index.ts:3373-3412` (direct turns) and
`:4170-4212` (room turns) moves into `server/system-prompt.ts`:

```ts
export type PromptSection = { id: string; label: string; text: string; bytes: number };
export function buildSystemPrompt(ctx: PromptContext): { text: string; sections: PromptSection[] };
```

Order is unchanged, with `soul` inserted directly after the persona line:

1. `persona` — `You are <name>… Role: <title>. About: <description>`
2. `soul` — `Your standing instructions:\n<soul>` when non-empty
3. computer environment, protected-input guard, plan note, Composio hint,
   browser prompt, coordination prompt, credential/routine/learn prompts,
   section context, memory, skills index, skill instructions, package
   playbooks, webhook provenance, mention nudge — as today

Both turn paths call the same builder. The room path passes its different
persona line and roster. The builder is pure: the call site reads memory and
syncs skill links as it does today and hands the resulting strings in, so the
builder itself does no I/O and is unit-tested by section.

### Migration

No automatic move. Existing bots keep working with `description` alone. The
Soul section shows a one-click **Move description into SOUL.md** action when
`description` is longer than 400 characters and `soul` is empty. It copies the
text, clears `description` to its first sentence, and logs both changes.

Setup mode (Part 2) triggers only when both `soul` and `description` are
empty, so existing bots are not interrupted.

### Skills

No new mechanism. Two gaps close:

- The Skills section gains **Import from GitHub**, calling the existing
  `POST /api/bots/:id/skills` (`server/index.ts:8381`) that no UI calls today.
- Each skill row shows what the prompt index line will say, when it is used
  (triggers, or "when the bot decides it is relevant"), where it came from
  (learned, imported URL, package), and its enabled state. Clicking opens the
  full `SKILL.md` read-only.

Kiwi's `PLAYBOOK.md` becomes a skill named `triage-discord-to-linear`. Its
cached Linear workspace map is memory.

## Part 2: self-setup

### The `propose_profile` tool

Added to the agents MCP server in `server/drivers/agents-proxy.ts`, beside
`propose_routine`:

```ts
{
  name: "propose_profile",
  description: "Propose changes to your own name, title, description, or standing instructions (SOUL.md). This only creates a confirmation card; nothing changes until the user approves it. After calling it, end the turn and do not claim the change is applied.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      title: { type: "string" },
      description: { type: "string", description: "One-line blurb shown in rosters." },
      soul: { type: "string", description: "Full replacement text for SOUL.md." },
      cwd: { type: "string", description: "Absolute path of the working folder its tools run in; \"\" means the private workspace. Validated like PATCH /api/bots (exists, is a folder) at proposal and again at confirm." },
      reason: { type: "string", description: "One sentence the user will see explaining why." },
    },
    required: ["reason"],
  },
}
```

- A bot may only propose changes to itself. The Chief of Staff may propose for
  a bot in its section by passing `for_bot_id`, mirroring `propose_routine`.
- The tool posts to a new internal route `POST /api/internal/profile-requests`,
  which normalizes through `parseBotProfilePatch` plus the new `soul` rule and
  stages a durable card, exactly as `server/routine-requests.ts` does for
  routines. The card carries `expectedUpdatedAt` and the current `soulHash`;
  approval fails closed if either moved.
- The card is a new `shared/profile-request.ts` shape rendered by
  `ApprovalCard.tsx`. It shows the reason, a unified diff for `soul`, and
  before/after for the short fields. Approval applies through
  `PATCH /api/bots/:id` semantics and appends a version-log row.
- Applying a `soul` change also rewrites the `SOUL.md` mirror and `soulHash`.

Tool-length caps match the field caps. The card's own copy is limited to the
first 400 lines of the diff, with "open in Soul section" for the rest.

### Setup mode

A prompt block, `setupPrompt`, is appended after `soul` in the builder when
**either** condition holds:

- the bot's `soul` and `description` are both empty, or
- the user's message is the `/setup` slash command, added to
  `src/lib/composer-commands.ts` beside `/learn`.

The block, in full:

> This bot has not been set up yet. Your job this conversation is to set
> yourself up from what the user tells you. First ask at most four questions
> that change what you would build: what the job is, when it should happen
> (on demand, on a schedule, or when something arrives), which apps or
> accounts it touches, and which folder on this computer it should work in
> (the block names the current folder, or says it has none, and tells the bot
> to offer to keep it). Then, before any tool call, tell the user in plain
> language what you intend: who you will be, what you will do and when, where
> you will work, what you will need from them, and what you will not do. Wait
> for a yes. When they say yes, first send one message that lists the cards
> you are about to raise, then make the tool calls — the cards must appear
> after that message, never before it; after the tool calls add at most one
> short line. The proposals, each of which the user must confirm:
> `propose_profile` for your identity, standing rules (keep SOUL.md short; put
> step-by-step procedure into a skill with `skill_manage`), and the working
> folder, `propose_routine` for anything scheduled (propose it paused),
> `request_credential` for any token. Never claim something is set up until
> its card is confirmed. Finish by saying what remains for the user to do by
> hand, such as authorizing an app or enabling a routine.

Amended 2026-09-05 after Omkar's first manual test: the folder question and
the message-before-cards rule were missing, and `cwd` joined the proposable
fields so the bot can set its own working folder through the same card.

Setup mode replaces the 4-option onboarding quiz. `server/store.ts:607-611`
stops seeding the card; the seeded greeting becomes "Hey, I'm Scout. Tell me
what you want me to do and I'll set myself up." A bot's first message is the
interview.

### What stays manual

External OAuth (Composio app connections, Linear, Google) and creating
third-party applications (a Discord bot and its message-content intent). Setup
mode's closing summary names these explicitly and links to the Access section.

## Part 3: the bot settings dialog

### Shape

A centered dialog, sized and styled like `SettingsModal.tsx`, with a left rail
of sections and a search box that filters sections by keyword, opened from the
same places `SettingsPanel` opens today. `SettingsPanel.tsx` is retired; its
controls move into sections. Per-bot settings still save on change, as today.

| Section | Contents |
|---|---|
| **Overview** | Generated. See below. Default section. |
| **Identity** | Name, title, one-line blurb (`description`), avatar card. |
| **Soul** | `SOUL.md` editor with byte counter against the cap, migration action, drift banner, last-changed line. |
| **Skills** | List with index line, triggers, provenance, enabled toggle, review, delete; Import from GitHub. |
| **Memory** | `MEMORY.md` editor and topic files, as today. |
| **Routines** | Sentences per routine with state, next run, last outcome; New schedule; Manage. |
| **Access** | Works on (Cloud, VM, this computer, browser, off), working folder, connected apps as a list of app names not a boolean, browser profile, webhooks, credentials held by name only. |
| **Model** | Provider, model, effort. |
| **Permissions** | Auto mode, review routine approvals, ask before contacting other bots, always-allow list, Chief of Staff. |
| **Voice & alerts** | Voice engine, voice, speak replies, notifications. |
| **History** | Change log with rollback for `SOUL.md`. |
| **Usage** | Existing usage card. |

### Overview page

Rendered from the folder plus the record. Every line is a sentence a
non-technical person can read. Layout in reading order:

1. **Who.** Name, title, blurb, and the first paragraph of `SOUL.md` with a
   "read all" link into the Soul section.
2. **Does.** One sentence per enabled routine ("Every 5 minutes, checks Discord
   and files to Linear. Next run 14:05."), one line per enabled skill ("Knows
   how to triage Discord into Linear"), and one line for webhooks.
3. **Can reach.** The computer it runs on and the folder it works in. The
   connected apps by name. Credentials it holds by name. Browser, if mounted.
4. **Won't.** One sentence per capability that is off or gated. This section
   is never empty for a fresh bot:
   - "Won't run commands without asking you first." (auto mode off)
   - "Won't contact other bots without asking." (peer comms gated)
   - "Has no connected apps." (composio off or no grants)
   - "Can't use a computer." (works on: off)
   - "Won't act on a schedule." (no enabled routines)
   - "Won't change its own instructions without your approval." (always)
5. **What the model sees.** A collapsed panel. Expanded, it shows every
   `PromptSection` from `buildSystemPrompt` with its label and byte count, the
   full text read-only, and a total ("about 6,200 tokens of fixed context per
   turn"). Served by `GET /api/bots/:id/system-prompt`, which builds the prompt
   for a hypothetical direct turn with no task note. It contains no secrets;
   the builder never sees keys.
6. **Recent changes.** The last five version-log rows, linking to History.

The same overview is what setup mode's closing summary points the user to, so
the bot's promise and the page agree by construction.

### Cards say the consequence

Every proposal card gains a consequence line under the change:

- Routine: "Will run 288 times a day. Each run starts a fresh session on
  <model>." Cost per run is shown when the usage store has a figure for the
  bot's model, otherwise omitted rather than guessed.
- Profile: "Changes what <name> is told on every turn. Nothing runs."
- Skill: "Adds one line to the prompt index; the body is read only when used."
- Credential: "Stored in the secure store. <name> can use it but never read it
  back."

### History

`server/profile-versions.ts`, taken from the bot-profile plan: an append-only
NDJSON file per bot at `~/.openmausbot/bots/<id>/history.ndjson`, mode 0600.
One row per accepted change:

```ts
{ at: number; actor: "user" | "bot" | "file" | "import" | "system";
  via: "ui" | `card:${string}` | "api" | "migration";
  field: string; summary: string; before?: string; after?: string }
```

`before` and `after` are stored in full only for `soul` (so rollback is a
plain write) and as one-line summaries otherwise. Rollback of `soul` goes
through the normal validation and appends its own row. Secrets never appear;
credential rows carry the name only.

### Mobile

iOS and Android get the Overview as a read-only page reached from the existing
profile view, fed by `GET /api/bots/:id/overview`, which returns the rendered
sentences as JSON so the phones do not reimplement the rules:

```ts
{ who: { name, title, blurb, soulLead }, does: string[], reaches: string[],
  wont: string[], recent: { at, summary }[] }
```

Cards already render on both phones. Setup mode therefore works from a phone
end to end, except the Access section's app connections, which remain desktop.

## Data and API changes

**`BotRecord`** (`server/store.ts`): add `soul: string` (default `""`),
`soulHash: string`, `soulDrift?: boolean`. Mirrored on the web `Bot` type.
Phones ignore unknown fields today and continue to.

**`shared/bot-profile.ts`**: add `soul: 24_000` to `BOT_PROFILE_LIMITS`.
`server/bot-profile.ts` accepts `soul` on the broad `PATCH /api/bots/:id` and
on the paired `PATCH /api/bots/:id/profile`, with a byte-length rule.

**New routes** on `server/index.ts`:

| Route | Purpose |
|---|---|
| `GET /api/bots/:id/system-prompt` | `PromptSection[]` for the overview |
| `GET /api/bots/:id/overview` | rendered overview JSON for phones and web |
| `GET /api/bots/:id/history` | version-log rows, newest first |
| `POST /api/bots/:id/history/rollback` | `{ at }`; `soul` only |
| `POST /api/bots/:id/soul/apply-file` and `/soul/discard-file` | drift resolution |
| `POST /api/internal/profile-requests` | stages a profile card (internal, agents MCP only) |

**New modules**: `server/system-prompt.ts`, `server/profile-requests.ts`,
`server/profile-versions.ts`, `server/bot-folder.ts` (mirror write, hash,
drift check, folder path), `shared/profile-request.ts`,
`src/components/BotSettingsDialog.tsx` with one file per section under
`src/components/bot-settings/`, `src/components/BotOverview.tsx`.

**Deleted**: `src/components/SettingsPanel.tsx` once every control has a
section; the onboarding options card seed.

**Bot deletion** removes `~/.openmausbot/bots/<id>/` alongside the workspace
and skill-state directories, in the same `deleteBot` path.

## Error handling

- `soul` over the cap: the same 400 shape as today's profile errors, with
  copy "standing instructions must be at most 24000 bytes". The editor
  counter turns red before submit; the tool call returns the error to the bot,
  which is told to shorten and move procedure into a skill.
- Card approval after the record moved: fails closed with "this bot changed
  since the proposal was made", as routine cards do.
- Drift: never silently applied; never breaks a turn.
- Mirror write failure (disk, permissions): the canonical field is already
  saved; the write is retried on next turn and the Soul section shows a
  warning. Prompt building never depends on the file.
- `propose_profile` from a non-Chief for another bot: 403, same copy pattern as
  `create_bot`.
- Setup mode never triggers for a bot that has either field set, so a user
  who types `/setup` on a configured bot gets the coach, and a bot that has
  been set up once is never re-interviewed by accident.

## Testing

- `server/system-prompt.test.ts`: section order, `soul` placement, byte
  counts, setup block presence under each trigger, room path parity with the
  old inline assembly (snapshot of a fixture bot before and after the refactor
  must be identical when `soul` is empty).
- `server/profile-requests.test.ts`: normalization, caps, self-only rule,
  Chief `for_bot_id`, stale `expectedUpdatedAt` and `soulHash` rejection.
- `server/bot-folder.test.ts`: mirror written on accept, hash stored, drift
  detected, apply-file validates and logs, discard rewrites.
- `server/profile-versions.test.ts`: append, redaction, rollback for `soul`,
  refusal for other fields.
- `server/index.test.ts` additions: new routes, deletion cleans the folder,
  `create_bot` cap.
- Web: component tests for the Overview's "won't" rules against fixture bots
  (fresh bot yields all six sentences; a bot with auto mode on drops the first).
- Manual: set up Kiwi from a blank bot on desktop, approve every card from the
  iPhone, confirm the overview matches the cards and the mirror matches
  `bots.json`.

## Rollout

Each step ships on its own, in order, and the product is coherent after each:

1. **Prompt builder and `soul`.** Extract `buildSystemPrompt`, add the field,
   mirror, hash, limit, and the preview route. No UI beyond a Soul textarea in
   the existing panel. Existing bots unchanged.
2. **`propose_profile` and history.** The tool, the card, the version log.
3. **The dialog.** Overview, sections, retire the strip. Import-from-GitHub for
   skills. Consequence lines on cards.
4. **Setup mode.** The prompt block, `/setup`, retire the quiz, raise the
   `create_bot` cap.
5. **Mobile overview.**

## Decisions made here

- Canonical `soul` lives in `bots.json`; `SOUL.md` is a mirror. Chosen over a
  bot-writable file because the persona must not be reachable by injected
  content. Chosen over a server-owned file with no field because a field makes
  the hash, the card diff, and the rollback trivial.
- `description` keeps its cap and its name. Renaming it would break the phone
  contract for no user-visible gain.
- Skills stay physically in `skill-state/`. Moving them is churn with no
  behavior change; the folder view symlinks.
- Sequential cards in v1, not one bundled setup card. The card machinery
  exists per kind; a bundle needs a new transaction path and can follow.
- The mirror-is-never-read rule protects against a bot with file tools; it
  does not protect against a bot with shell or HTTP tools, because any
  loopback process is trusted by `server/request-auth.ts` and can call the
  routes directly. This branch does not widen that boundary; the guarantee
  is "a bot cannot rewrite its persona through the filesystem".
