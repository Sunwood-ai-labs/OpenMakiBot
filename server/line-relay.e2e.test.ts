import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";
import { createLineRelay, type LineRelay, type LineRelayApprovalMode, type LineRelayConfig } from "./line-relay.ts";

const lineUserId = `U${"1234567890abcdef".repeat(2)}`;
const channelSecret = "fixture-line-channel-secret";
const accessToken = "fixture-line-access-token";
const linePushUrl = new URL("https://api.line.me/v2/bot/message/push");

const objectSchema = z.record(z.string(), z.unknown());
const createdBotSchema = z.object({
  bot: z.object({ id: z.string(), activeTaskId: z.string() }).passthrough(),
}).passthrough();
const createdTaskSchema = z.object({
  task: z.object({ threadId: z.string() }).passthrough(),
}).passthrough();
const taskSwitchSchema = z.object({
  bot: z.object({ threadId: z.string() }).passthrough(),
}).passthrough();
const listedBotsSchema = z.object({
  bots: z.array(z.object({
    id: z.string(),
    threadId: z.string(),
    tasks: z.array(z.object({ threadId: z.string(), approvalMode: z.string().optional() }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();
const messageSchema = z.object({
  id: z.string(),
  role: z.string(),
  kind: z.string(),
  text: z.string().optional(),
  sendId: z.string().optional(),
  requestMessageId: z.string().optional(),
  requestPending: z.boolean().optional(),
  turnTerminal: z.boolean().optional(),
  turnSucceeded: z.boolean().optional(),
}).passthrough();
const threadPageSchema = z.object({ messages: z.array(messageSchema) }).passthrough();
const requestSnapshotSchema = z.object({
  messageId: z.string(),
  phase: z.enum(["working", "waiting", "settled", "untracked"]),
  messages: z.array(messageSchema),
}).passthrough();
const linePushSchema = z.object({
  to: z.string(),
  messages: z.array(z.object({ type: z.literal("text"), text: z.string() }).passthrough()).min(1),
}).passthrough();

type LinePush = z.infer<typeof linePushSchema>;
type RelayLog = { eventId: string; outcome: string };
type RelayResource = { relay: LineRelay; closed: boolean };
type ApiResult = { status: number; body: unknown };
type E2eFixture = {
  session: VerificationServer;
  sink: Server;
  sinkUrl: string;
  pushes: LinePush[];
  sinkErrors: string[];
  relayLogs: RelayLog[];
  relays: RelayResource[];
  relayConfig?: LineRelayConfig;
  replyStatePath: string;
  evidence: unknown[];
};

let activeFixture: E2eFixture | null = null;

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function sinkRequest(request: IncomingMessage, response: ServerResponse, fixture: Pick<E2eFixture, "pushes" | "sinkErrors">): Promise<void> {
  if (request.method !== "POST" || request.url !== "/v2/bot/message/push") {
    response.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fixture.sinkErrors.push("LINE push body was not valid JSON");
    response.writeHead(400).end();
    return;
  }
  const parsed = linePushSchema.safeParse(decoded);
  if (!parsed.success) {
    fixture.sinkErrors.push(parsed.error.message);
    response.writeHead(400).end();
    return;
  }
  fixture.pushes.push(parsed.data);
  response.writeHead(200, { "content-type": "application/json" }).end("{}");
}

async function makeFixture(replies: string[], options: { scriptedRoom?: boolean } = {}): Promise<E2eFixture> {
  const replyStatePath = join(tmpdir(), `openmausbot-line-replies-${randomUUID()}.txt`);
  const pushes: LinePush[] = [];
  const sinkErrors: string[] = [];
  const sink = createServer((request, response) => {
    void sinkRequest(request, response, { pushes, sinkErrors }).catch((error: unknown) => {
      sinkErrors.push(error instanceof Error ? error.message : String(error));
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    });
  });
  let session: VerificationServer | undefined;
  try {
    await listen(sink);
    const address = sink.address();
    if (!address || typeof address === "string") throw new Error("LINE sink did not bind to a TCP port");
    const sinkUrl = `http://127.0.0.1:${address.port}`;
    session = await launchVerificationServer({
      ...process.env,
      FAKE_CLAUDE_MODE: "happy",
      FAKE_CLAUDE_REPLIES: JSON.stringify(replies),
      FAKE_CLAUDE_REPLY_STATE: replyStatePath,
    }, undefined, undefined, undefined, undefined, options.scriptedRoom ? { scripted: true } : undefined);
    const fixture: E2eFixture = {
      session,
      sink,
      sinkUrl,
      pushes,
      sinkErrors,
      relayLogs: [],
      relays: [],
      replyStatePath,
      evidence: [{ fixture: session.info, sinkUrl }],
    };
    activeFixture = fixture;
    return fixture;
  } catch (error) {
    await closeServer(sink);
    await session?.close();
    rmSync(replyStatePath, { force: true });
    throw error;
  }
}

async function startRelay(fixture: E2eFixture, config: LineRelayConfig): Promise<RelayResource> {
  fixture.relayConfig = config;
  const appOrigin = new URL(fixture.session.info.url).origin;
  const relay = createLineRelay({
    config,
    pollIntervalMs: 10,
    fetchImpl: async (input, init) => {
      const url = input instanceof URL ? input : new URL(input);
      if (url.origin === linePushUrl.origin) return fetch(`${fixture.sinkUrl}${url.pathname}${url.search}`, init);
      if (url.origin !== appOrigin) throw new Error("LINE relay attempted a request outside the fixture origins");
      return fetch(input, init);
    },
    log: (entry) => fixture.relayLogs.push(entry),
  });
  const resource = { relay, closed: false };
  fixture.relays.push(resource);
  await relay.start();
  return resource;
}

async function stopRelay(resource: RelayResource): Promise<void> {
  if (resource.closed) return;
  resource.closed = true;
  await resource.relay.close();
}

function relayAddress(resource: RelayResource): string {
  const address = resource.relay.address();
  if (!address) throw new Error("LINE relay did not bind to a port");
  return `http://${address.host}:${address.port}`;
}

function signedWebhook(event: unknown, redelivery: boolean): { body: string; signature: string } {
  const envelope = {
    destination: "Uabcdefabcdefabcdefabcdefabcdefab",
    events: [{ ...objectSchema.parse(event), deliveryContext: { isRedelivery: redelivery } }],
  };
  const body = JSON.stringify(envelope);
  return { body, signature: createHmac("sha256", channelSecret).update(body).digest("base64") };
}

async function postWebhook(resource: RelayResource, event: unknown, redelivery = false, signatureOverride?: string): Promise<ApiResult> {
  const webhook = signedWebhook(event, redelivery);
  const response = await fetch(`${relayAddress(resource)}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signatureOverride ?? webhook.signature },
    body: webhook.body,
  });
  const body: unknown = await response.json();
  const result = { status: response.status, body };
  activeFixture?.evidence.push({ webhook: { status: response.status, event, redelivery }, result: body });
  return result;
}

function makeTextEvent(text: string, webhookEventId = randomUUID()) {
  return {
    type: "message",
    webhookEventId,
    timestamp: Date.now(),
    source: { type: "user", userId: lineUserId },
    message: { id: randomUUID(), type: "text", text },
    replyToken: "fixture-reply-token",
  };
}

async function runControl(fixture: E2eFixture, args: string[]): Promise<unknown> {
  const result = await runControlOmb([...args, "--url", fixture.session.info.url]);
  fixture.evidence.push({ command: ["control:omb", ...args], result });
  return result;
}

type ChiefTarget = { botId: string; initialThreadId: string; lineThreadId: string };

async function createChiefTarget(
  fixture: E2eFixture,
  options: { managedSections?: string[] } = {},
): Promise<ChiefTarget> {
  const created = createdBotSchema.parse(await runControl(fixture, [
    "new-bot", "--name", "LINE Chief fixture", "--section", "Leadership",
  ]));
  const chiefId = created.bot.id;
  const chiefSettings = await api(fixture, "PATCH", `/api/bots/${chiefId}`, options.managedSections
    ? { chiefOfStaff: true, managedSections: options.managedSections, acknowledgePeerScope: true }
    : { chiefOfStaff: true });
  expect(chiefSettings.status, JSON.stringify(chiefSettings.body)).toBe(200);
  const createdTask = await api(fixture, "POST", `/api/bots/${chiefId}/tasks`, {
    title: "LINE Chief thread",
    approvalMode: "ask",
  });
  expect(createdTask.status, JSON.stringify(createdTask.body)).toBe(201);
  const lineThreadId = createdTaskSchema.parse(createdTask.body).task.threadId;
  const selected = await api(fixture, "POST", `/api/bots/${chiefId}/tasks/${created.bot.activeTaskId}`, {});
  expect(selected.status, JSON.stringify(selected.body)).toBe(200);
  expect(taskSwitchSchema.parse(selected.body).bot.threadId).toBe(created.bot.activeTaskId);
  return { botId: chiefId, initialThreadId: created.bot.activeTaskId, lineThreadId };
}

function configFor(fixture: E2eFixture, target: ChiefTarget, approvalMode?: LineRelayApprovalMode): LineRelayConfig {
  return {
    appUrl: fixture.session.info.url,
    userId: lineUserId,
    botId: target.botId,
    threadId: target.lineThreadId,
    statePath: join(fixture.session.info.dataDir, "line-relay-state.json"),
    channelSecret,
    accessToken,
    port: 0,
    ...(approvalMode ? { approvalMode } : {}),
  };
}

async function readTaskApprovalMode(fixture: E2eFixture, target: ChiefTarget): Promise<string> {
  const response = await api(fixture, "GET", "/api/bots?messages=0");
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const inventory = listedBotsSchema.parse(response.body);
  const task = inventory.bots.find((bot) => bot.id === target.botId)?.tasks?.find((candidate) => candidate.threadId === target.lineThreadId);
  if (!task?.approvalMode) throw new Error("The fixture did not return the dedicated task approval mode");
  return task.approvalMode;
}

async function expectNoUserMessages(fixture: E2eFixture, threadId: string): Promise<void> {
  const page = threadPageSchema.parse((await api(fixture, "GET", `/api/threads/${threadId}/messages?limit=100`)).body);
  expect(page.messages.filter((message) => message.role === "user")).toEqual([]);
}

describe("LINE relay against a disposable OpenMausBot runtime", () => {
  afterEach(async () => {
    const fixture = activeFixture;
    activeFixture = null;
    if (!fixture) return;
    const evidencePath = `${fixture.session.info.logPath}.line-relay-e2e.json`;
    try {
      writeFileSync(evidencePath, JSON.stringify({
        fixture: fixture.session.info,
        evidence: fixture.evidence,
        linePushes: fixture.pushes,
        relayOutcomes: fixture.relayLogs,
        sinkErrors: fixture.sinkErrors,
        limitation: "Disposable launchVerificationServer and fake CLI only. LINE push requests were redirected to a loopback sink; no LINE credentials, live app data, or paid model calls were used.",
      }, null, 2));
      console.info(JSON.stringify({ logPath: fixture.session.info.logPath, evidencePath }));
    } finally {
      for (const resource of fixture.relays) await stopRelay(resource);
      await closeServer(fixture.sink);
      await fixture.session.close();
      rmSync(fixture.replyStatePath, { force: true });
    }
  });

  it("keeps consecutive signed LINE messages on the dedicated Chief task while another task is selected, including after relay restart", async () => {
    const fixture = await makeFixture(["LINE_FINAL_ONE", "LINE_FINAL_TWO"]);
    const target = await createChiefTarget(fixture);
    const config = configFor(fixture, target);
    let relay = await startRelay(fixture, config);
    await expectNoUserMessages(fixture, target.lineThreadId);

    const firstEvent = makeTextEvent("Please review the release checklist.");
    const firstWebhook = await postWebhook(relay, firstEvent);
    expect(firstWebhook.status, JSON.stringify(firstWebhook.body)).toBe(200);
    const firstSendId = await waitForSendId(fixture, target.botId, target.lineThreadId, firstEvent.message.text);
    await waitForSettled(fixture, target.botId, target.lineThreadId, firstSendId);
    await expect.poll(() => fixture.pushes.map((push) => push.messages.map((message) => message.text).join("")), { timeout: 20_000 })
      .toEqual(["LINE_FINAL_ONE"]);

    await stopRelay(relay);
    relay = await startRelay(fixture, config);
    const duplicate = await postWebhook(relay, firstEvent, true);
    expect(duplicate.status, JSON.stringify(duplicate.body)).toBe(200);

    const secondEvent = makeTextEvent("Now check the deployment notes.");
    const secondWebhook = await postWebhook(relay, secondEvent);
    expect(secondWebhook.status, JSON.stringify(secondWebhook.body)).toBe(200);
    const secondSendId = await waitForSendId(fixture, target.botId, target.lineThreadId, secondEvent.message.text);
    await waitForSettled(fixture, target.botId, target.lineThreadId, secondSendId);
    await expect.poll(() => fixture.pushes.map((push) => push.messages.map((message) => message.text).join("")), { timeout: 20_000 })
      .toEqual(["LINE_FINAL_ONE", "LINE_FINAL_TWO"]);

    const finalPage = threadPageSchema.parse((await api(fixture, "GET", `/api/threads/${target.lineThreadId}/messages?limit=100`)).body);
    const userMessages = finalPage.messages.filter((message) => message.role === "user");
    expect(userMessages.map((message) => message.text)).toEqual([
      firstEvent.message.text,
      secondEvent.message.text,
    ]);
    expect(userMessages.map((message) => message.sendId)).toEqual([firstSendId, secondSendId]);
    expect(secondSendId).not.toBe(firstSendId);
    const finals = finalPage.messages.filter((message) => message.role === "bot" && message.kind === "text" && message.turnTerminal);
    expect(finals.map((message) => message.text)).toEqual(["LINE_FINAL_ONE", "LINE_FINAL_TWO"]);
    expect(finals.every((message) => message.turnSucceeded === true)).toBe(true);
    expect(fixture.pushes.map((push) => push.to)).toEqual([lineUserId, lineUserId]);

    const listed = listedBotsSchema.parse((await api(fixture, "GET", "/api/bots?messages=0")).body);
    expect(listed.bots.find((bot) => bot.id === target.botId)?.threadId).toBe(target.initialThreadId);
    const selectedPage = threadPageSchema.parse((await api(fixture, "GET", `/api/threads/${target.initialThreadId}/messages?limit=100`)).body);
    expect(selectedPage.messages.some((message) => message.text === firstEvent.message.text || message.text === secondEvent.message.text)).toBe(false);
    expect(fixture.sinkErrors).toEqual([]);
    fixture.evidence.push({
      chiefId: target.botId,
      lineThreadId: target.lineThreadId,
      selectedThreadId: target.initialThreadId,
      userMessages,
      terminalReplies: finals,
      pushes: fixture.pushes,
    });
  }, 60_000);

  it("uses Full only when the dedicated task and relay are both explicitly configured for it", async () => {
    const fixture = await makeFixture(["LINE_FULL_MODE_FINAL"]);
    const target = await createChiefTarget(fixture);
    expect(await readTaskApprovalMode(fixture, target)).toBe("ask");
    const operatorModeChange = await api(fixture, "PATCH", `/api/bots/${target.botId}/tasks/${target.lineThreadId}`, { approvalMode: "full" });
    expect(operatorModeChange.status, JSON.stringify(operatorModeChange.body)).toBe(200);
    expect(await readTaskApprovalMode(fixture, target)).toBe("full");
    const relay = await startRelay(fixture, configFor(fixture, target, "full"));

    const event = makeTextEvent("Review the fixture using the configured Full task.");
    const webhook = await postWebhook(relay, event);
    expect(webhook.status, JSON.stringify(webhook.body)).toBe(200);
    const sendId = await waitForSendId(fixture, target.botId, target.lineThreadId, event.message.text);
    await waitForSettled(fixture, target.botId, target.lineThreadId, sendId);
    await expect.poll(() => fixture.pushes.map((push) => push.messages.map((message) => message.text).join("")), { timeout: 20_000 })
      .toEqual(["LINE_FULL_MODE_FINAL"]);

    expect(await readTaskApprovalMode(fixture, target)).toBe("full");
    expect(fixture.sinkErrors).toEqual([]);
    fixture.evidence.push({ approvalMode: "full", target, sendId, pushes: fixture.pushes });
  }, 45_000);

  it("ignores invalid signatures, unknown LINE users, and group messages without extra Chief turns", async () => {
    const fixture = await makeFixture(["AUTHORIZED_LINE_REPLY"]);
    const target = await createChiefTarget(fixture);
    const relay = await startRelay(fixture, configFor(fixture, target));
    await expectNoUserMessages(fixture, target.lineThreadId);

    const invalidSignatureEvent = makeTextEvent("INVALID_SIGNATURE_MUST_NOT_RUN");
    const invalidSignature = await postWebhook(relay, invalidSignatureEvent, false, "invalid-signature");
    expect(invalidSignature.status).toBe(401);

    const unknownUserEvent = {
      ...makeTextEvent("UNKNOWN_USER_MUST_NOT_RUN"),
      source: { type: "user", userId: `U${"f".repeat(32)}` },
    };
    expect((await postWebhook(relay, unknownUserEvent)).status).toBe(200);

    const groupEvent = {
      ...makeTextEvent("GROUP_MESSAGE_MUST_NOT_RUN"),
      source: { type: "group", groupId: `G${"a".repeat(32)}` },
    };
    expect((await postWebhook(relay, groupEvent)).status).toBe(200);

    const authorizedEvent = makeTextEvent("AUTHORIZED_LINE_MESSAGE");
    expect((await postWebhook(relay, authorizedEvent)).status).toBe(200);
    const sendId = await waitForSendId(fixture, target.botId, target.lineThreadId, authorizedEvent.message.text);
    await waitForSettled(fixture, target.botId, target.lineThreadId, sendId);
    await expect.poll(() => fixture.pushes.map((push) => push.messages.map((message) => message.text).join("")), { timeout: 20_000 })
      .toEqual(["AUTHORIZED_LINE_REPLY"]);

    const page = threadPageSchema.parse((await api(fixture, "GET", `/api/threads/${target.lineThreadId}/messages?limit=100`)).body);
    expect(page.messages.filter((message) => message.role === "user").map((message) => message.text))
      .toEqual([authorizedEvent.message.text]);
    expect(fixture.sinkErrors).toEqual([]);
    fixture.evidence.push({ target, transcript: page.messages, pushes: fixture.pushes });
  }, 45_000);

  it("holds a delegated Chief acknowledgment until the gated teammate result is final", async () => {
    const fixture = await makeFixture(["unused scripted reply"], { scriptedRoom: true });
    const teammate = createdBotSchema.parse(await runControl(fixture, [
      "new-bot", "--name", "LINE Engineering fixture", "--section", "Engineering",
    ]));
    const target = await createChiefTarget(fixture, { managedSections: ["Engineering"] });
    const gatePath = join(fixture.session.info.dataDir, "line-engineering-gate");
    const planPath = join(fixture.session.info.dataDir, "room-plan.json");
    writeFileSync(planPath, JSON.stringify({
      [target.botId]: {
        steps: [{ arguments: {
          bot_ids: [teammate.bot.id],
          request_key: "line-review",
          message: "Review the deployment notes and report the result.",
        } }],
        reply: "Assigned to Engineering",
        resumeReply: "LINE_DELEGATED_FINAL_RESULT",
      },
      [teammate.bot.id]: { gateFile: gatePath, reply: "The gated deployment review passed." },
    }));
    const relay = await startRelay(fixture, configFor(fixture, target));
    await expectNoUserMessages(fixture, target.lineThreadId);

    const event = makeTextEvent("Ask Engineering to review the deployment notes.");
    expect((await postWebhook(relay, event)).status).toBe(200);
    const sendId = await waitForSendId(fixture, target.botId, target.lineThreadId, event.message.text);
    const readSnapshot = async () => {
      const response = await api(fixture, "GET", `/api/bots/${target.botId}/requests/${encodeURIComponent(sendId)}?threadId=${encodeURIComponent(target.lineThreadId)}`);
      if (response.status !== 200) return null;
      const parsed = requestSnapshotSchema.safeParse(response.body);
      return parsed.success ? parsed.data : null;
    };
    await expect.poll(async () => {
      const snapshot = await readSnapshot();
      if (snapshot?.phase !== "waiting") return null;
      return snapshot.messages
        .filter((message) => message.role === "bot" && message.kind === "text" && message.turnTerminal)
        .map((message) => message.text);
    }, { timeout: 30_000 }).toEqual(["Assigned to Engineering"]);
    const waiting = await readSnapshot();
    if (!waiting) throw new Error("The delegated LINE request snapshot disappeared while waiting for Engineering");
    const initialTerminals = waiting.messages.filter((message) => message.role === "bot" && message.kind === "text" && message.turnTerminal);
    expect(initialTerminals.map((message) => message.text)).toEqual(["Assigned to Engineering"]);

    await expect.poll(() => fixture.pushes.length, { timeout: 20_000 }).toBe(1);
    const waitingPushes = fixture.pushes.flatMap((push) => push.messages.map((message) => message.text));
    expect(waitingPushes).toHaveLength(1);
    expect(waitingPushes).not.toContain("Assigned to Engineering");

    writeFileSync(gatePath, "release the isolated fake teammate");
    await waitForSettled(fixture, target.botId, target.lineThreadId, sendId);
    await expect.poll(() => fixture.pushes.length, { timeout: 30_000 }).toBe(2);
    const delivered = fixture.pushes.flatMap((push) => push.messages.map((message) => message.text));
    expect(delivered).not.toContain("Assigned to Engineering");
    expect(delivered).toContain("LINE_DELEGATED_FINAL_RESULT");
    const finalSnapshot = await readSnapshot();
    expect(finalSnapshot?.phase).toBe("settled");
    expect(finalSnapshot?.messages.findLast((message) => message.role === "bot" && message.kind === "text" && message.turnTerminal)?.text)
      .toBe("LINE_DELEGATED_FINAL_RESULT");
    fixture.evidence.push({
      target,
      teammateId: teammate.bot.id,
      waitingPhase: waiting.phase,
      initialTerminals,
      pushesWhileTeammateWasGated: waitingPushes,
      finalPushes: delivered,
      finalPhase: finalSnapshot?.phase,
    });
  }, 75_000);

  it("sends long emoji replies in LINE-sized messages without splitting a surrogate pair", async () => {
    const reply = "🙂".repeat(2501);
    expect(reply.length).toBe(5002);
    const fixture = await makeFixture([reply]);
    const target = await createChiefTarget(fixture);
    const relay = await startRelay(fixture, configFor(fixture, target));
    await expectNoUserMessages(fixture, target.lineThreadId);

    const event = makeTextEvent("Return the long emoji fixture reply.");
    expect((await postWebhook(relay, event)).status).toBe(200);
    const sendId = await waitForSendId(fixture, target.botId, target.lineThreadId, event.message.text);
    await waitForSettled(fixture, target.botId, target.lineThreadId, sendId);
    await expect.poll(() => fixture.pushes.length, { timeout: 20_000 }).toBe(1);

    const delivered = fixture.pushes.flatMap((push) => push.messages.map((message) => message.text));
    expect(delivered).toHaveLength(2);
    expect(delivered.join("")).toBe(reply);
    for (const text of delivered) {
      expect(text.length).toBeLessThanOrEqual(5000);
      const firstUnit = text.charCodeAt(0);
      const lastUnit = text.charCodeAt(text.length - 1);
      expect(firstUnit >= 0xdc00 && firstUnit <= 0xdfff).toBe(false);
      expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff).toBe(false);
    }
    fixture.evidence.push({ target, deliveredLengths: delivered.map((text) => text.length), reassembledReply: delivered.join("") });
  }, 45_000);
});

async function api(fixture: E2eFixture, method: string, path: string, body?: unknown): Promise<ApiResult> {
  const response = await fetch(`${fixture.session.info.url}${path}`, {
    method,
    headers: { origin: fixture.session.info.url, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody: unknown = await response.json();
  fixture.evidence.push({ method, path, body, status: response.status, response: responseBody });
  return { status: response.status, body: responseBody };
}

async function waitForSendId(fixture: E2eFixture, botId: string, threadId: string, text: string): Promise<string> {
  const read = async (): Promise<string | null> => {
    const page = threadPageSchema.parse((await api(fixture, "GET", `/api/threads/${threadId}/messages?limit=100`)).body);
    return page.messages.find((message) => message.role === "user" && message.text === text)?.sendId ?? null;
  };
  await expect.poll(read, { timeout: 20_000 }).toMatch(/^line-[a-f0-9]{64}$/);
  const sendId = await read();
  if (!sendId) throw new Error(`LINE request for ${JSON.stringify(text)} has no send ID`);
  const accepted = await api(fixture, "GET", `/api/bots/${botId}/requests/${encodeURIComponent(sendId)}?threadId=${encodeURIComponent(threadId)}`);
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  return sendId;
}

async function waitForSettled(fixture: E2eFixture, botId: string, threadId: string, sendId: string): Promise<void> {
  const readPhase = async () => {
    const response = await api(fixture, "GET", `/api/bots/${botId}/requests/${encodeURIComponent(sendId)}?threadId=${encodeURIComponent(threadId)}`);
    if (response.status !== 200) return null;
    const parsed = requestSnapshotSchema.safeParse(response.body);
    return parsed.success ? parsed.data.phase : null;
  };
  await expect.poll(readPhase, { timeout: 30_000 }).toBe("settled");
}
