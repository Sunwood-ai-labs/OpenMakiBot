// Per-bot profile history: an append-only NDJSON file in the bot folder,
// one row per changed field. Same discipline as decision-log.ts — 0600,
// through redactSecrets, serialized per file, fire-and-forget — because a
// history write must never fail the change it records. Full before/after
// text is kept only for the soul (so rollback is a plain write); other
// fields keep short one-liners.
import { appendFile } from "node:fs/promises";
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
