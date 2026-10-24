import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_ACTIVE_EVENTS = 1000;
const MAX_RETAINED_EVENTS = 10_000;
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LINE_TEXT_CODE_UNITS = 5000;
const MAX_APP_RESPONSE_BYTES = 1024 * 1024 + 64 * 1024;
const RETRY_KEY_WINDOW_MS = 24 * 60 * 60 * 1000;
const APP_REQUEST_TIMEOUT_MS = 10_000;
const LINE_REQUEST_TIMEOUT_MS = 10_000;
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

const idSchema = z.string().regex(/^[\w-]+$/);
const userIdSchema = z.string().regex(/^U[0-9a-f]{32}$/i);
const appUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase()) &&
      !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === "/" || url.pathname === "");
  } catch {
    return false;
  }
}, "appUrl must be a loopback HTTP origin");

const lineRelayConfigSchema = z.object({
  appUrl: appUrlSchema,
  userId: userIdSchema,
  botId: idSchema,
  threadId: idSchema,
  statePath: z.string().min(1).refine(isAbsolute, "statePath must be absolute"),
  channelSecret: z.string().min(1),
  accessToken: z.string().min(1),
  port: z.number().int().min(0).max(65535),
}).strict();

export type LineRelayConfig = z.infer<typeof lineRelayConfigSchema>;

const bindingSchema = z.object({
  appUrl: appUrlSchema,
  userId: userIdSchema,
  botId: idSchema,
  threadId: idSchema,
}).strict();

const pushBatchSchema = z.object({
  retryKey: z.string().uuid(),
  messages: z.array(z.string().min(1).max(MAX_LINE_TEXT_CODE_UNITS)).min(1).max(5),
}).strict();

const recordBaseSchema = z.object({
  eventId: z.string().min(1).max(120),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  sequence: z.number().int().positive(),
  receivedAt: z.number().int().nonnegative(),
  eventTimestamp: z.number().int().nonnegative(),
  sourceUserId: userIdSchema,
  text: z.string().max(MAX_LINE_TEXT_CODE_UNITS),
  sendId: z.string().regex(/^line-[a-f0-9]{64}$/),
});

const watchStateSchema = z.object({
  kind: z.literal("watching"),
  expectedActiveLeafId: idSchema.nullable(),
  requestMessageId: idSchema,
  waitingNoticeSent: z.boolean(),
}).strict();

const outboxResumeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("watching"), expectedActiveLeafId: idSchema.nullable(), requestMessageId: idSchema, waitingNoticeSent: z.literal(true) }).strict(),
  z.object({ kind: z.literal("completed") }).strict(),
  z.object({ kind: z.literal("manual"), reason: z.string().min(1).max(80) }).strict(),
]);

const eventRecordSchema = recordBaseSchema.extend({
  state: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pending") }).strict(),
    z.object({ kind: z.literal("sending"), expectedActiveLeafId: idSchema.nullable() }).strict(),
    watchStateSchema,
    z.object({
      kind: z.literal("outbox"),
      recipient: userIdSchema,
      batches: z.array(pushBatchSchema).min(1),
      batchIndex: z.number().int().nonnegative(),
      createdAt: z.number().int().nonnegative(),
      requiresTarget: z.boolean(),
      resume: outboxResumeSchema,
    }).strict(),
    z.object({ kind: z.literal("completed") }).strict(),
    z.object({ kind: z.literal("manual"), reason: z.string().min(1).max(80) }).strict(),
  ]),
}).strict();

const relayStateSchema = z.object({
  version: z.literal(1),
  binding: bindingSchema,
  nextSequence: z.number().int().positive(),
  records: z.record(z.string(), eventRecordSchema),
}).strict();

type EventRecord = z.infer<typeof eventRecordSchema>;
type EventState = EventRecord["state"];
type WatchingState = z.infer<typeof watchStateSchema>;
type RelayState = z.infer<typeof relayStateSchema>;
type PushBatch = z.infer<typeof pushBatchSchema>;
type OutboxResume = z.infer<typeof outboxResumeSchema>;
type TargetStatus = "available" | "unavailable" | "retry";

const webhookEnvelopeSchema = z.object({ events: z.array(z.unknown()).max(1000) }).passthrough();
const webhookEventSchema = z.object({
  type: z.string().min(1).max(80),
  webhookEventId: z.string().min(1).max(120).regex(/^[\w-]+$/),
  timestamp: z.number().int().nonnegative(),
  source: z.object({ type: z.string().min(1).max(40), userId: userIdSchema.optional() }).passthrough().optional(),
  message: z.object({ id: z.string().min(1).max(120).optional(), type: z.string().min(1).max(40), text: z.string().max(MAX_LINE_TEXT_CODE_UNITS) }).passthrough().optional(),
}).passthrough();

const healthSchema = z.object({ capabilities: z.object({ guardedMessages: z.literal(1), guardedRequests: z.literal(1) }).passthrough() }).passthrough();
const botInventorySchema = z.object({
  bots: z.array(z.object({
    id: idSchema,
    chiefOfStaff: z.boolean().optional(),
    hidden: z.boolean().optional(),
    tasks: z.array(z.object({ threadId: idSchema }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();
const threadMessagesSchema = z.object({
  activeLeafId: idSchema.nullable(),
  messages: z.array(z.unknown()),
}).passthrough();
const guardedReceiptSchema = z.object({ message: z.object({ id: idSchema }).passthrough() }).passthrough();
const requestMessageSchema = z.object({
  id: idSchema,
  role: z.string(),
  kind: z.string(),
  text: z.string().optional(),
  sendId: z.string().optional(),
  requestMessageId: idSchema.optional(),
  turnId: z.string().optional(),
  turnTerminal: z.boolean().optional(),
  turnSucceeded: z.boolean().optional(),
  requestPending: z.boolean().optional(),
  requestCancelled: z.boolean().optional(),
}).passthrough();
const requestSnapshotSchema = z.object({
  messageId: idSchema,
  activeLeafId: idSchema.nullable(),
  phase: z.enum(["working", "waiting", "settled", "untracked"]),
  messages: z.array(requestMessageSchema),
}).passthrough();
const guardedErrorSchema = z.object({ code: z.string().optional() }).passthrough();

type RelayFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CreateLineRelayOptions {
  config: LineRelayConfig;
  fetchImpl?: RelayFetch;
  pollIntervalMs?: number;
  log?: (entry: { eventId: string; outcome: string }) => void;
}

export interface LineRelay {
  start(): Promise<void>;
  close(): Promise<void>;
  address(): { host: string; port: number } | null;
}

function canonicalOrigin(value: string): string {
  return new URL(value).origin;
}

function parseLineRelayConfig(env: NodeJS.ProcessEnv): LineRelayConfig {
  const parsed = lineRelayConfigSchema.safeParse({
    appUrl: env.OMB_LINE_APP_URL,
    userId: env.OMB_LINE_USER_ID,
    botId: env.OMB_LINE_BOT_ID,
    threadId: env.OMB_LINE_THREAD_ID,
    statePath: env.OMB_LINE_STATE_PATH,
    channelSecret: env.OMB_LINE_CHANNEL_SECRET,
    accessToken: env.OMB_LINE_CHANNEL_ACCESS_TOKEN,
    port: Number(env.OMB_LINE_RELAY_PORT ?? "8765"),
  });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((field): field is string => typeof field === "string"))];
    throw new Error(`Invalid LINE relay configuration fields: ${fields.join(", ")}`);
  }
  return { ...parsed.data, appUrl: canonicalOrigin(parsed.data.appUrl) };
}

export function lineRelayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LineRelayConfig {
  return parseLineRelayConfig(env);
}

function bindingFor(config: LineRelayConfig): RelayState["binding"] {
  return {
    appUrl: canonicalOrigin(config.appUrl),
    userId: config.userId,
    botId: config.botId,
    threadId: config.threadId,
  };
}

function timingSafeSignature(channelSecret: string, body: Buffer, signature: string | undefined): boolean {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const actual = Buffer.from(signature, "base64");
  const expected = createHmac("sha256", channelSecret).update(body).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function textBatches(text: string): PushBatch[] {
  const chunks: string[] = [];
  let chunk = "";
  let codeUnits = 0;
  for (const character of text) {
    if (codeUnits + character.length > MAX_LINE_TEXT_CODE_UNITS) {
      chunks.push(chunk);
      chunk = "";
      codeUnits = 0;
    }
    chunk += character;
    codeUnits += character.length;
  }
  if (chunk) chunks.push(chunk);
  const batches: PushBatch[] = [];
  for (let index = 0; index < chunks.length; index += 5) {
    batches.push({ retryKey: randomUUID(), messages: chunks.slice(index, index + 5) });
  }
  return batches;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function acquireStateLock(lockPath: string): Promise<{ nonce: string; release(): Promise<void> }> {
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
      await handle.close();
      handle = null;
      return {
        nonce,
        async release() {
          try {
            const existing: unknown = JSON.parse(await readFile(lockPath, "utf8"));
            const owner = z.object({ pid: z.number().int(), nonce: z.string() }).safeParse(existing);
            if (owner.success && owner.data.pid === process.pid && owner.data.nonce === nonce) {
              await unlink(lockPath);
            }
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          }
        },
      };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
        try { await unlink(lockPath); }
        catch (cleanupError) {
          if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) {
            throw new Error("LINE relay could not remove its incomplete state lock");
          }
        }
        throw error;
      }
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      let existing: unknown;
      try {
        existing = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        throw new Error("LINE relay state lock exists and cannot be checked; verify no relay is running before removing it");
      }
      const lock = z.object({ pid: z.number().int().positive() }).passthrough().safeParse(existing);
      if (!lock.success || isProcessAlive(lock.data.pid)) {
        throw new Error("LINE relay state is already owned by another live process");
      }
      await unlink(lockPath);
    }
  }
  throw new Error("Could not acquire LINE relay state lock");
}

async function readJsonBody(req: IncomingMessage, maximumBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maximumBytes) {
        settled = true;
        resolve(null);
        return;
      }
      chunks.push(buffer);
    });
    req.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
    req.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(encoded), "cache-control": "no-store" });
  res.end(encoded);
}

function responseJsonSchema<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function makeFetch(fetchImpl?: RelayFetch): RelayFetch {
  return fetchImpl ?? ((input, init) => fetch(input, init));
}

export function createLineRelay(options: CreateLineRelayOptions): LineRelay {
  const config = lineRelayConfigSchema.parse({ ...options.config, appUrl: canonicalOrigin(options.config.appUrl) });
  const appUrl = canonicalOrigin(config.appUrl);
  const fetchRequest = makeFetch(options.fetchImpl);
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const log = options.log ?? ((entry) => console.info(JSON.stringify({ component: "line-relay", ...entry })));
  const statePath = config.statePath;
  const lockPath = `${statePath}.lock`;
  const server: Server = createServer((req, res) => {
    void handleHttpRequest(req, res).catch(() => {
      if (!res.headersSent) respond(res, 500, { error: "relay request failed" });
      else res.destroy();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  let state: RelayState | null = null;
  let lock: Awaited<ReturnType<typeof acquireStateLock>> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  let closeRequested = false;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let drainPromise: Promise<void> | null = null;
  let mutationTail = Promise.resolve();

  const mutateState = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = mutationTail.then(operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const persistState = async (snapshot: RelayState): Promise<void> => {
    writeFileAtomic(statePath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  };

  const updateRecord = async (eventId: string, update: (record: EventRecord) => EventRecord): Promise<void> => {
    await mutateState(async () => {
      if (!state) throw new Error("LINE relay state is not loaded");
      const current = state.records[eventId];
      if (!current) return;
      const candidate = eventRecordSchema.parse(update(current));
      const updated = candidate.state.kind === "completed" || candidate.state.kind === "manual"
        ? { ...candidate, text: "" }
        : candidate;
      const next: RelayState = { ...state, records: { ...state.records, [eventId]: updated } };
      await persistState(next);
      state = next;
    });
  };

  const addEvent = async (eventId: string, eventTimestamp: number, sourceUserId: string, text: string, digest: string): Promise<"added" | "duplicate" | "conflict" | "full"> =>
    mutateState(async () => {
      if (!state) throw new Error("LINE relay state is not loaded");
      const cutoff = Date.now() - EVENT_RETENTION_MS;
      const retainedRecords = Object.fromEntries(Object.entries(state.records).filter(([, record]) =>
        record.eventTimestamp >= cutoff || (record.state.kind !== "completed" && record.state.kind !== "manual"),
      ));
      const current = retainedRecords[eventId];
      if (current) return current.digest === digest ? "duplicate" : "conflict";
      const activeCount = Object.values(retainedRecords).filter((record) => record.state.kind !== "completed" && record.state.kind !== "manual").length;
      if (activeCount >= MAX_ACTIVE_EVENTS || Object.keys(retainedRecords).length >= MAX_RETAINED_EVENTS) return "full";
      const record = eventRecordSchema.parse({
        eventId,
        digest,
        sequence: state.nextSequence,
        receivedAt: Date.now(),
        eventTimestamp,
        sourceUserId,
        text,
        sendId: `line-${createHash("sha256").update(eventId).digest("hex")}`,
        state: { kind: "pending" },
      });
      const next: RelayState = {
        ...state,
        nextSequence: state.nextSequence + 1,
        records: { ...retainedRecords, [eventId]: record },
      };
      await persistState(next);
      state = next;
      return "added";
    });

  const appRequest = async (path: string, method = "GET", body?: unknown): Promise<{ status: number; body: unknown } | null> => {
    if (closeRequested) throw new Error("LINE relay has been closed");
    try {
      const response = await fetchRequest(new URL(path, appUrl), {
        method,
        headers: { origin: appUrl, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(APP_REQUEST_TIMEOUT_MS),
      });
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > MAX_APP_RESPONSE_BYTES) return null;
      let parsed: unknown;
      try { parsed = JSON.parse(responseText); }
      catch { parsed = null; }
      return { status: response.status, body: parsed };
    } catch {
      return null;
    }
  };

  const validateCapabilities = async (): Promise<void> => {
    const response = await appRequest("/api/health");
    const health = response?.status === 200 ? responseJsonSchema(healthSchema, response.body) : null;
    if (!health) throw new Error("Chief relay requires an app health endpoint with guarded message and request capabilities");
    const probe = await appRequest(`/api/bots/${encodeURIComponent(config.botId)}/messages/guarded`, "POST", {
      threadId: config.threadId,
      sendId: `line-preflight-${randomUUID()}`,
      text: "LINE relay preflight",
      expectedActiveLeafId: `line-stale-${randomUUID()}`,
      expectedApprovalMode: "ask",
    });
    if (!probe) throw new Error("Chief relay could not verify local guarded-send access; check app reachability and retry");
    if (probe.status === 401 || probe.status === 403) {
      throw new Error("This app does not allow a standalone loopback relay; use a headless self-hosted app, not the desktop-managed app");
    }
    const probeCode = responseJsonSchema(guardedErrorSchema, probe.body)?.code;
    if (probe.status === 409 && probeCode === "guarded_permissions") {
      throw new Error("The configured Chief task must use Ask approval mode; create a dedicated Ask task and retry");
    }
    if (probe.status !== 409 || (probeCode !== "guarded_branch" && probeCode !== "spend_cap")) {
      throw new Error("Chief relay could not verify the guarded-send route without sending a message");
    }
  };

  const validateTarget = async (): Promise<TargetStatus> => {
    const response = await appRequest("/api/bots?messages=0");
    if (!response || response.status >= 500) return "retry";
    if (response.status !== 200) return "unavailable";
    const inventory = responseJsonSchema(botInventorySchema, response.body);
    if (!inventory) return "retry";
    const bot = inventory.bots.find((candidate) => candidate.id === config.botId);
    return bot && bot.chiefOfStaff === true && bot.hidden !== true &&
      bot.tasks?.some((task) => task.threadId === config.threadId) ? "available" : "unavailable";
  };

  const threadLeaf = async (): Promise<string | null | undefined> => {
    const response = await appRequest(`/api/threads/${encodeURIComponent(config.threadId)}/messages?limit=1`);
    const page = response?.status === 200 ? responseJsonSchema(threadMessagesSchema, response.body) : null;
    return page ? page.activeLeafId : undefined;
  };

  const putOutbox = async (record: EventRecord, text: string, resume: OutboxResume, requiresTarget = true): Promise<void> => {
    if (!text.trim()) {
      await updateRecord(record.eventId, (current) => ({ ...current, state: { kind: "manual", reason: "empty_reply" } }));
      log({ eventId: record.eventId, outcome: "manual_empty_reply" });
      return;
    }
    const batches = textBatches(text);
    if (!batches.length) return;
    await updateRecord(record.eventId, (current) => ({
      ...current,
      state: { kind: "outbox", recipient: config.userId, batches, batchIndex: 0, createdAt: Date.now(), requiresTarget, resume },
    }));
  };

  const markManual = async (record: EventRecord, reason: string): Promise<void> => {
    await putOutbox(record,
      "Chiefへの依頼を安全に完了できませんでした。対象タスクと承認待ちをOpenMakiBotで確認してください。LINEから承認操作はしていません。",
      { kind: "manual", reason }, false);
    log({ eventId: record.eventId, outcome: `manual_${reason}` });
  };

  const handlePending = async (record: EventRecord): Promise<void> => {
    const target = await validateTarget();
    if (target === "retry") return;
    if (target === "unavailable") {
      await markManual(record, "target_unavailable");
      return;
    }
    const expectedActiveLeafId = await threadLeaf();
    if (expectedActiveLeafId === undefined) return;
    await updateRecord(record.eventId, (current) => ({ ...current, state: { kind: "sending", expectedActiveLeafId } }));
    await handleSending({ ...record, state: { kind: "sending", expectedActiveLeafId } });
  };

  const handleSending = async (record: EventRecord & { state: { kind: "sending"; expectedActiveLeafId: string | null } }): Promise<void> => {
    const target = await validateTarget();
    if (target === "retry") return;
    if (target === "unavailable") {
      await markManual(record, "target_unavailable");
      return;
    }
    const response = await appRequest(`/api/bots/${encodeURIComponent(config.botId)}/messages/guarded`, "POST", {
      threadId: config.threadId,
      sendId: record.sendId,
      text: record.text,
      expectedActiveLeafId: record.state.expectedActiveLeafId,
      expectedApprovalMode: "ask",
    });
    if (!response) return;
    if (response.status >= 500) return;
    if (response.status === 409 && responseJsonSchema(guardedErrorSchema, response.body)?.code === "guarded_busy") {
      const latestLeaf = await threadLeaf();
      if (latestLeaf !== undefined && latestLeaf !== record.state.expectedActiveLeafId) {
        await updateRecord(record.eventId, (current) => ({ ...current, state: { kind: "sending", expectedActiveLeafId: latestLeaf } }));
      }
      log({ eventId: record.eventId, outcome: "guarded_busy_retry" });
      return;
    }
    const receipt = response.status === 202 ? responseJsonSchema(guardedReceiptSchema, response.body) : null;
    if (!receipt) {
      const code = responseJsonSchema(guardedErrorSchema, response.body)?.code;
      await markManual(record, code === "guarded_branch" ? "conversation_changed" : code === "guarded_permissions" ? "approval_mode_changed" : `guarded_send_http_${response.status}`);
      return;
    }
    await updateRecord(record.eventId, (current) => ({
      ...current,
      state: {
        kind: "watching",
        expectedActiveLeafId: record.state.expectedActiveLeafId,
        requestMessageId: receipt.message.id,
        waitingNoticeSent: false,
      },
    }));
  };

  const handleWatching = async (record: EventRecord & { state: WatchingState }): Promise<void> => {
    const target = await validateTarget();
    if (target === "retry") return;
    if (target === "unavailable") {
      await markManual(record, "target_unavailable");
      return;
    }
    const response = await appRequest(`/api/bots/${encodeURIComponent(config.botId)}/requests/${encodeURIComponent(record.sendId)}?threadId=${encodeURIComponent(config.threadId)}`);
    if (!response || response.status >= 500) return;
    const snapshot = response.status === 200 ? responseJsonSchema(requestSnapshotSchema, response.body) : null;
    if (!snapshot || snapshot.messageId !== record.state.requestMessageId) {
      await markManual(record, "request_untracked");
      return;
    }
    if (snapshot.phase === "untracked") {
      await markManual(record, "request_untracked");
      return;
    }
    if (snapshot.phase === "working") return;
    if (snapshot.phase === "waiting") {
      if (!record.state.waitingNoticeSent) {
        const notice = "Chiefはチームメンバーの応答または入力を待っています。承認や回答が必要な場合はOpenMakiBotで対応してください。最終回答はこのLINEに届きます。LINEから承認は行いません。";
        await putOutbox(record, notice, {
          kind: "watching",
          expectedActiveLeafId: record.state.expectedActiveLeafId,
          requestMessageId: record.state.requestMessageId,
          waitingNoticeSent: true,
        });
      }
      return;
    }
    const userRequest = snapshot.messages.find((message) => message.id === snapshot.messageId && message.role === "user");
    const latestTerminal = snapshot.messages.findLast((message) => message.role === "bot" && message.kind === "text" && message.turnTerminal === true);
    const latestOutcome = snapshot.messages.findLast((message) => message.turnSucceeded !== undefined);
    if (!userRequest || userRequest.sendId !== record.sendId || userRequest.requestCancelled === true ||
        userRequest.requestPending !== false || latestTerminal?.requestMessageId !== snapshot.messageId ||
        latestTerminal.turnSucceeded !== true || latestOutcome?.turnSucceeded !== true || latestOutcome.turnId !== latestTerminal.turnId) {
      await markManual(record, "final_not_proven");
      return;
    }
    await putOutbox(record, latestTerminal.text ?? "", { kind: "completed" });
  };

  const handleOutbox = async (record: EventRecord & { state: Extract<EventState, { kind: "outbox" }> }): Promise<void> => {
    if (record.state.requiresTarget) {
      const target = await validateTarget();
      if (target === "retry") return;
      if (target === "unavailable") {
        await markManual(record, "target_unavailable");
        return;
      }
    }
    if (Date.now() - record.state.createdAt >= RETRY_KEY_WINDOW_MS) {
      await updateRecord(record.eventId, (current) => ({ ...current, state: { kind: "manual", reason: "line_retry_window_expired" } }));
      log({ eventId: record.eventId, outcome: "manual_line_retry_window_expired" });
      return;
    }
    const batch = record.state.batches[record.state.batchIndex];
    if (!batch) {
      await updateRecord(record.eventId, (current) => ({ ...current, state: record.state.resume }));
      return;
    }
    let response: Response;
    try {
      response = await fetchRequest(LINE_PUSH_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
          "x-line-retry-key": batch.retryKey,
        },
        body: JSON.stringify({
          to: record.state.recipient,
          messages: batch.messages.map((text) => ({ type: "text", text })),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(LINE_REQUEST_TIMEOUT_MS),
      });
    } catch {
      return;
    }
    const retryAccepted = response.status === 409 && Boolean(response.headers.get("x-line-accepted-request-id"));
    if ((response.status >= 200 && response.status < 300) || retryAccepted) {
      const nextIndex = record.state.batchIndex + 1;
      const finished = nextIndex >= record.state.batches.length;
      await updateRecord(record.eventId, (current) => ({
        ...current,
        state: finished ? record.state.resume : { ...record.state, batchIndex: nextIndex },
      }));
      log({ eventId: record.eventId, outcome: "line_push_accepted" });
      return;
    }
    if (response.status >= 500) return;
    await updateRecord(record.eventId, (current) => ({ ...current, state: { kind: "manual", reason: `line_push_http_${response.status}` } }));
    log({ eventId: record.eventId, outcome: `manual_line_push_http_${response.status}` });
  };

  const processOne = async (): Promise<void> => {
    if (!state) return;
    const record = Object.values(state.records).sort((left, right) => left.sequence - right.sequence)
      .find((candidate) => candidate.state.kind !== "completed" && candidate.state.kind !== "manual");
    if (!record) return;
    switch (record.state.kind) {
      case "pending":
        await handlePending(record);
        return;
      case "sending":
        await handleSending({ ...record, state: record.state });
        return;
      case "watching":
        await handleWatching({ ...record, state: record.state });
        return;
      case "outbox":
        await handleOutbox({ ...record, state: record.state });
        return;
      case "completed":
      case "manual":
        return;
      default: {
        const exhaustive: never = record.state;
        return exhaustive;
      }
    }
  };

  const drainOne = (): Promise<void> => {
    if (drainPromise) return drainPromise;
    let current: Promise<void>;
    current = processOne().catch(() => undefined).finally(() => {
      if (drainPromise === current) drainPromise = null;
    });
    drainPromise = current;
    return current;
  };

  const handleHttpRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === "GET" && req.url === "/health") {
      const records = state ? Object.values(state.records) : [];
      respond(res, 200, {
        ok: started,
        queued: records.filter((record) => record.state.kind === "pending" || record.state.kind === "sending" || record.state.kind === "watching" || record.state.kind === "outbox").length,
        manual: records.filter((record) => record.state.kind === "manual").length,
      });
      return;
    }
    if (req.method !== "POST" || req.url !== "/webhook") {
      respond(res, 404, { error: "not found" });
      return;
    }
    const body = await readJsonBody(req, MAX_WEBHOOK_BYTES);
    if (!body) {
      res.shouldKeepAlive = false;
      res.once("finish", () => req.destroy());
      respond(res, 413, { error: "webhook body too large" });
      req.resume();
      return;
    }
    const signature = req.headers["x-line-signature"];
    if (!timingSafeSignature(config.channelSecret, body, typeof signature === "string" ? signature : undefined)) {
      respond(res, 401, { error: "invalid LINE signature" });
      return;
    }
    let decoded: unknown;
    try { decoded = JSON.parse(body.toString("utf8")); }
    catch {
      respond(res, 400, { error: "invalid JSON" });
      return;
    }
    const envelope = webhookEnvelopeSchema.safeParse(decoded);
    if (!envelope.success) {
      respond(res, 400, { error: "invalid webhook envelope" });
      return;
    }
    const accepted: Array<{ eventId: string; eventTimestamp: number; sourceUserId: string; text: string; digest: string }> = [];
    for (const rawEvent of envelope.data.events) {
      const event = webhookEventSchema.safeParse(rawEvent);
      if (!event.success || event.data.type !== "message" || event.data.source?.type !== "user" ||
          event.data.source.userId !== config.userId || event.data.message?.type !== "text") continue;
      if (event.data.timestamp < Date.now() - EVENT_RETENTION_MS) continue;
      const text = event.data.message.text.trim();
      if (!text) continue;
      accepted.push({
        eventId: event.data.webhookEventId,
        eventTimestamp: event.data.timestamp,
        sourceUserId: event.data.source.userId,
        text,
        digest: createHash("sha256").update(JSON.stringify({
          type: event.data.type,
          webhookEventId: event.data.webhookEventId,
          timestamp: event.data.timestamp,
          sourceType: event.data.source.type,
          sourceUserId: event.data.source.userId,
          messageId: event.data.message.id,
          messageType: event.data.message.type,
          messageText: event.data.message.text,
        })).digest("hex"),
      });
    }
    for (const event of accepted) {
      const result = await addEvent(event.eventId, event.eventTimestamp, event.sourceUserId, event.text, event.digest);
      if (result === "full") {
        respond(res, 503, { error: "relay event store is full" });
        return;
      }
      if (result === "conflict") log({ eventId: event.eventId, outcome: "duplicate_event_id_conflict" });
      if (result === "added") log({ eventId: event.eventId, outcome: "event_persisted" });
    }
    respond(res, 200, { ok: true });
    void drainOne();
  };

  const loadState = async (): Promise<void> => {
    await mkdir(dirname(statePath), { recursive: true });
    lock = await acquireStateLock(lockPath);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new Error("LINE relay state file is invalid or unreadable");
      const initial: RelayState = { version: 1, binding: bindingFor(config), nextSequence: 1, records: {} };
      await persistState(initial);
      state = initial;
      return;
    }
    const parsed = relayStateSchema.safeParse(raw);
    if (!parsed.success) throw new Error("LINE relay state file does not match the supported state schema");
    if (JSON.stringify(parsed.data.binding) !== JSON.stringify(bindingFor(config))) {
      throw new Error("LINE relay state belongs to a different app, LINE user, Chief bot, or thread");
    }
    state = parsed.data;
  };

  const closeListener = async (): Promise<void> => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };

  const startAttempt = async (): Promise<void> => {
    try {
      await loadState();
      if (closeRequested) throw new Error("LINE relay closed before startup completed");
      await validateCapabilities();
      if (closeRequested) throw new Error("LINE relay closed before startup completed");
      const target = await validateTarget();
      if (closeRequested) throw new Error("LINE relay closed before startup completed");
      if (target === "retry") throw new Error("Chief relay could not verify the app target; check loopback reachability and retry");
      if (target === "unavailable") throw new Error("Chief relay requires the configured visible Chief bot and its dedicated thread");
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("error", onError);
          reject(error);
        };
        server.once("error", onError);
        server.listen(config.port, "127.0.0.1", () => {
          server.off("error", onError);
          resolve();
        });
      });
      if (closeRequested) throw new Error("LINE relay closed before startup completed");
      started = true;
      timer = setInterval(() => void drainOne(), pollIntervalMs);
      timer.unref();
      void drainOne();
    } catch (error) {
      let closeError: unknown;
      try { await closeListener(); }
      catch (listenerError) { closeError = listenerError; }
      await drainPromise;
      await mutationTail;
      await lock?.release();
      lock = null;
      throw closeError ?? error;
    } finally {
      startPromise = null;
    }
  };

  const start = (): Promise<void> => {
    if (closeRequested) return Promise.reject(new Error("LINE relay has been closed"));
    if (started) return Promise.resolve();
    if (startPromise) return startPromise;
    startPromise = startAttempt();
    return startPromise;
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closeRequested = true;
    closePromise = (async () => {
      if (timer) clearInterval(timer);
      timer = null;
      started = false;
      await startPromise?.catch(() => undefined);
      await closeListener();
      await drainPromise;
      await mutationTail;
      await lock?.release();
      lock = null;
    })();
    return closePromise;
  };

  return {
    start,
    close,
    address() {
      const address = server.address();
      return address && typeof address !== "string" ? { host: address.address, port: address.port } : null;
    },
  };
}
