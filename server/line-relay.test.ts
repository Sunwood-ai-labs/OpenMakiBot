import { createHmac, randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Resvg } from "@resvg/resvg-js";
import { createLineRelay, lineRelayConfigFromEnv, type LineRelay, type LineRelayApprovalMode, type LineRelayConfig } from "./line-relay.ts";

const USER_ID = `U${"a".repeat(32)}`;
const SECRET = "fixture-channel-secret";
const TOKEN = "fixture-access-token";
const BOT_ID = "bot-chief";
const THREAD_ID = "thread-dedicated";
const linePushMessageSchema = z.object({ type: z.enum(["text", "flex", "image"]) }).passthrough();
const linePushBodySchema = z.object({ messages: z.array(linePushMessageSchema) }).passthrough();

type TestEvent = {
  type: "message";
  webhookEventId: string;
  timestamp: number;
  source: { type: "user"; userId: string };
  message: { id: string; type: "text"; text: string };
  deliveryContext?: { isRedelivery: boolean };
};

type AppFixture = {
  url: string;
  server: Server;
  posts: Array<Record<string, unknown>>;
  currentLeaf: string | null;
  busyOnce: boolean;
  bot503Once: boolean;
  botChecks: number;
  approvalMode: LineRelayApprovalMode;
  expectedApprovalModes: string[];
  requestPhase: "working" | "waiting" | "settled" | "untracked";
  finalText: string;
  finalAttachments: Array<{ path: string; mime: string; bytes: Buffer; kind?: string; requestMessageId?: string; turnId?: string }>;
  attachmentRequests: string[];
};

type SinkFixture = {
  url: string;
  server: Server;
  requests: Array<{ retryKey: string | undefined; body: unknown }>;
  deliveries: string[];
  accepted: Map<string, string>;
  loseFirstResponse: boolean;
};

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body);
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed);
      }
      catch { resolve(null); }
    });
  });
}

async function makeApp(approvalMode: LineRelayApprovalMode = "ask"): Promise<AppFixture> {
  const fixture: AppFixture = {
    url: "", server: createServer(), posts: [], currentLeaf: null, busyOnce: false,
    bot503Once: false, botChecks: 0, approvalMode, expectedApprovalModes: [], requestPhase: "settled", finalText: "Final answer from Chief",
    finalAttachments: [], attachmentRequests: [],
  };
  fixture.server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { capabilities: { guardedMessages: 1, guardedRequests: 1 } });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/bots") {
        fixture.botChecks += 1;
        if (fixture.bot503Once) {
          fixture.bot503Once = false;
          sendJson(res, 503, { error: "temporary fixture outage" });
          return;
        }
        sendJson(res, 200, { bots: [{ id: BOT_ID, chiefOfStaff: true, hidden: false, tasks: [{ threadId: THREAD_ID }] }] });
        return;
      }
      if (req.method === "GET" && url.pathname === `/api/threads/${THREAD_ID}/messages`) {
        sendJson(res, 200, { messages: [], activeLeafId: fixture.currentLeaf });
        return;
      }
      const attachmentRoute = url.pathname.match(/^\/api\/attachments\/([\w.-]+)$/);
      if (req.method === "GET" && attachmentRoute) {
        const attachment = fixture.finalAttachments.find((candidate) => candidate.path.split(/[\\/]/).at(-1) === attachmentRoute[1]);
        fixture.attachmentRequests.push(attachmentRoute[1]!);
        if (!attachment) {
          sendJson(res, 404, { error: "no such attachment" });
          return;
        }
        res.writeHead(200, {
          "content-type": attachment.mime,
          "content-length": String(attachment.bytes.byteLength),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(attachment.bytes);
        return;
      }
      if (req.method === "POST" && url.pathname === `/api/bots/${BOT_ID}/messages/guarded`) {
        const body = await readBody(req) as Record<string, unknown> | null;
        const requestedMode = body?.expectedApprovalMode ?? "ask";
        fixture.expectedApprovalModes.push(typeof requestedMode === "string" ? requestedMode : "invalid");
        if (requestedMode !== fixture.approvalMode) {
          sendJson(res, 409, { code: "guarded_permissions" });
          return;
        }
        if (body?.sendId && String(body.sendId).startsWith("line-preflight-") &&
            body.expectedActiveLeafId !== fixture.currentLeaf) {
          sendJson(res, 409, { code: "guarded_branch" });
          return;
        }
        if (fixture.busyOnce) {
          fixture.busyOnce = false;
          fixture.currentLeaf = "leaf-after-busy";
          sendJson(res, 409, { code: "guarded_busy" });
          return;
        }
        if (!body) {
          sendJson(res, 400, { error: "bad body" });
          return;
        }
        fixture.posts.push(body);
        const sendId = String(body.sendId);
        const messageId = `request-${fixture.posts.length}`;
        sendJson(res, 202, { message: { id: messageId, sendId } });
        return;
      }
      const request = url.pathname.match(new RegExp(`^/api/bots/${BOT_ID}/requests/(.+)$`));
      if (req.method === "GET" && request) {
        const sendId = request[1];
        const messageId = fixture.posts.find((body) => body.sendId === sendId) ? `request-${fixture.posts.findIndex((body) => body.sendId === sendId) + 1}` : "";
        const attachmentMessages = fixture.finalAttachments.map((attachment, index) => ({
          id: `attached-${index}`,
          role: "bot",
          kind: "text",
          text: "Attached a synthetic image.",
          requestMessageId: attachment.requestMessageId ?? messageId,
          turnId: attachment.turnId ?? "turn-final",
          attachments: [{ kind: attachment.kind ?? "image", path: attachment.path, mime: attachment.mime, name: "fixture.png" }],
        }));
        sendJson(res, 200, {
          messageId,
          activeLeafId: "final-leaf",
          phase: fixture.requestPhase,
          messages: [
            { id: messageId, role: "user", kind: "text", sendId, requestPending: false },
            ...attachmentMessages,
            { id: "final-message", role: "bot", kind: "text", text: fixture.finalText, requestMessageId: messageId, turnId: "turn-final", turnTerminal: true, turnSucceeded: true },
          ],
        });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })().catch(() => sendJson(res, 500, { error: "fixture failed" }));
  });
  fixture.url = await listen(fixture.server);
  return fixture;
}

async function makeSink(): Promise<SinkFixture> {
  const fixture: SinkFixture = {
    url: "", server: createServer(), requests: [], deliveries: [], accepted: new Map(), loseFirstResponse: false,
  };
  fixture.server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req) as { to?: string; messages?: Array<{ type: string; text?: string }> } | null;
      const retryKey = typeof req.headers["x-line-retry-key"] === "string" ? req.headers["x-line-retry-key"] : undefined;
      fixture.requests.push({ retryKey, body });
      const acceptedId = retryKey ? fixture.accepted.get(retryKey) : undefined;
      if (acceptedId) {
        sendJson(res, 409, { message: "The retry key is already accepted" }, { "x-line-accepted-request-id": acceptedId });
        return;
      }
      const requestId = `line-request-${fixture.accepted.size + 1}`;
      if (retryKey) fixture.accepted.set(retryKey, requestId);
      for (const message of body?.messages ?? []) {
        if (message.type === "text" && message.text !== undefined) fixture.deliveries.push(message.text);
      }
      sendJson(res, 200, { sentMessages: [{ id: "sent-1" }] }, { "x-line-request-id": requestId });
    })().catch(() => sendJson(res, 500, { error: "fixture failed" }));
  });
  fixture.url = await listen(fixture.server);
  return fixture;
}

function config(appUrl: string, statePath: string, overrides: Partial<LineRelayConfig> = {}): LineRelayConfig {
  return {
    appUrl,
    userId: USER_ID,
    botId: BOT_ID,
    threadId: THREAD_ID,
    statePath,
    channelSecret: SECRET,
    accessToken: TOKEN,
    port: 0,
    ...overrides,
  };
}

async function signedWebhook(relay: LineRelay, event: TestEvent, signature = true): Promise<Response> {
  const address = relay.address();
  if (!address) throw new Error("relay listener is not running");
  const body = JSON.stringify({ destination: "Uchannel", events: [event] });
  const digest = createHmac("sha256", SECRET).update(body).digest("base64");
  return fetch(`http://${address.host}:${address.port}/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature ? digest : "invalid",
    },
    body,
  });
}

function event(eventId: string, text: string, userId = USER_ID): TestEvent {
  return {
    type: "message",
    webhookEventId: eventId,
    timestamp: Date.now(),
    source: { type: "user", userId },
    message: { id: `message-${eventId}`, type: "text", text },
  };
}

function addFixtureImage(
  app: AppFixture,
  directory: string,
  provenance: { kind?: string; requestMessageId?: string; turnId?: string } = {},
): { name: string; bytes: Buffer } {
  const bytes = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#456789"/></svg>').render().asPng());
  const name = `${randomUUID()}.png`;
  const path = join(directory, "attachments", name);
  app.finalAttachments.push({ path, mime: "image/png", bytes, ...provenance });
  return { name, bytes };
}

async function requestRelayMedia(
  relay: LineRelay,
  path: string,
  host: string,
  method = "GET",
): Promise<{ statusCode: number | undefined; headers: IncomingMessage["headers"]; body: Buffer }> {
  const address = relay.address();
  if (!address) throw new Error("relay listener is not running");
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: address.host, port: address.port, path, method, headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once("error", reject);
      response.once("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    request.end();
  });
}

describe("LINE Chief relay boundaries", () => {
  const relays: LineRelay[] = [];
  const servers: Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(relays.splice(0).map((relay) => relay.close()));
    await Promise.all(servers.splice(0).map(closeServer));
    for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("checks the raw signature, ignores other sources, and reuses the accepted request after restart", async () => {
    const app = await makeApp();
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-test-"));
    tempDirs.push(directory);
    const statePath = join(directory, "relay-state.json");
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const create = () => createLineRelay({ config: config(app.url, statePath), fetchImpl, pollIntervalMs: 10 });
    const relay = create();
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("bad-signature-event", "hello"), false)).status).toBe(401);
    expect((await signedWebhook(relay, event("unknown-user-event", "hello", `U${"b".repeat(32)}`))).status).toBe(200);
    expect(app.posts).toHaveLength(0);
    expect(sink.requests).toHaveLength(0);

    const inbound = event("valid-event-00000001", "Please check the release.");
    expect((await signedWebhook(relay, inbound)).status).toBe(200);
    await expect.poll(() => sink.deliveries.length, { timeout: 5000 }).toBe(1);
    expect(app.posts).toHaveLength(1);
    expect(app.posts[0]).toMatchObject({
      threadId: THREAD_ID,
      text: "Please check the release.",
      expectedApprovalMode: "ask",
    });
    expect(app.posts[0]).not.toHaveProperty("onBehalfOf");
    expect(sink.deliveries).toEqual(["Final answer from Chief"]);

    expect((await signedWebhook(relay, { ...inbound, deliveryContext: { isRedelivery: true } })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.posts).toHaveLength(1);
    expect(sink.deliveries).toHaveLength(1);

    await relay.close();
    const restarted = create();
    relays.push(restarted);
    await restarted.start();
    expect((await signedWebhook(restarted, { ...inbound, deliveryContext: { isRedelivery: true } })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.posts).toHaveLength(1);
    expect(sink.deliveries).toHaveLength(1);

    await restarted.close();
    const mismatched = createLineRelay({ config: config(app.url, statePath, { userId: `U${"c".repeat(32)}` }), fetchImpl });
    relays.push(mismatched);
    await expect(mismatched.start()).rejects.toThrow("different app, LINE user, Chief bot, or thread");
    const corrected = create();
    relays.push(corrected);
    await corrected.start();
    expect((await fetch(`http://${corrected.address()?.host}:${corrected.address()?.port}/health`).then((response) => response.json()))).toMatchObject({ ok: true });
  }, 15_000);

  it("cannot turn its preflight into a message when a populated task is cleared", async () => {
    const app = await makeApp();
    servers.push(app.server);
    app.currentLeaf = "existing-leaf";
    const directory = mkdtempSync(join(tmpdir(), "line-relay-preflight-test-"));
    tempDirs.push(directory);
    let preflightLeaf: unknown;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages/guarded")) {
        const payload = z.object({ sendId: z.string(), expectedActiveLeafId: z.string().nullable() })
          .parse(JSON.parse(String(init?.body)));
        if (payload.sendId.startsWith("line-preflight-")) {
          app.currentLeaf = null;
          preflightLeaf = payload.expectedActiveLeafId;
        }
      }
      return fetch(input, init);
    };
    const relay = createLineRelay({ config: config(app.url, join(directory, "state.json")), fetchImpl });
    relays.push(relay);
    await relay.start();
    expect(preflightLeaf).toMatch(/^line-stale-/);
    expect(app.posts).toEqual([]);
  });

  it("uses the configured Full mode for both the guarded preflight and message", async () => {
    const app = await makeApp("full");
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-full-mode-test-"));
    tempDirs.push(directory);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({
      config: config(app.url, join(directory, "relay-state.json"), { approvalMode: "full" }),
      fetchImpl,
      pollIntervalMs: 10,
    });
    relays.push(relay);
    await relay.start();

    const inbound = event("full-mode-event-00000001", "Check the fixture in Full mode.");
    expect((await signedWebhook(relay, inbound)).status).toBe(200);
    await expect.poll(() => sink.deliveries.length, { timeout: 5000 }).toBe(1);

    expect(app.expectedApprovalModes).toEqual(["full", "full"]);
    expect(app.posts).toHaveLength(1);
    expect(app.posts[0]).toMatchObject({ text: inbound.message.text, expectedApprovalMode: "full" });
    expect(sink.deliveries).toEqual(["Final answer from Chief"]);
  }, 10_000);

  it("does not push success-shaped output when the exact request remains untracked", async () => {
    const app = await makeApp();
    app.requestPhase = "untracked";
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-untracked-final-test-"));
    tempDirs.push(directory);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({
      config: config(app.url, join(directory, "relay-state.json")),
      fetchImpl,
      pollIntervalMs: 10,
    });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("untracked-success-event-000001", "Check this result."))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);

    expect(app.posts).toHaveLength(1);
    expect(sink.deliveries).toEqual([
      "Chiefの依頼結果を安全に確認できませんでした。OpenMakiBotで対象タスクの会話を確認してください。LINEから承認操作はしていません。",
    ]);
    expect(sink.deliveries).not.toContain(app.finalText);
  }, 10_000);

  it("persists exact owned image URLs and retry payloads across a relay restart", async () => {
    const app = await makeApp();
    const directory = mkdtempSync(join(tmpdir(), "line-relay-media-retry-test-"));
    tempDirs.push(directory);
    const ownedImage = addFixtureImage(app, directory);
    addFixtureImage(app, directory, { turnId: "older-turn" });
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const statePath = join(directory, "relay-state.json");
    const publicOrigin = "https://line-relay.fixture.invalid:10000";
    let loseFirstResponse = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== "api.line.me") return fetch(input, init);
      const response = await fetch(`${sink.url}${url.pathname}`, init);
      if (loseFirstResponse && response.status === 200) {
        loseFirstResponse = false;
        throw new Error("simulated lost LINE response after acceptance");
      }
      return response;
    };
    const relayConfig = config(app.url, statePath, { publicOrigin });
    const relay = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 1000 });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("image-retry-event-00000001", "Send the attached image."))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);
    const firstRequest = sink.requests[0]!;
    const firstPayload = linePushBodySchema.parse(firstRequest.body);
    const imageMessage = firstPayload.messages.find((message) => message.type === "image");
    expect(firstPayload.messages.map((message) => message.type)).toEqual(["text", "image"]);
    expect(firstRequest.body).toMatchObject({ to: USER_ID });
    expect(imageMessage).toMatchObject({
      type: "image",
      originalContentUrl: expect.stringMatching(/^https:\/\/line-relay\.fixture\.invalid:10000\/line\/media\/[A-Za-z0-9_-]{43}\/original$/),
      previewImageUrl: expect.stringMatching(/^https:\/\/line-relay\.fixture\.invalid:10000\/line\/media\/[A-Za-z0-9_-]{43}\/preview$/),
    });
    const originalUrl = new URL(String(imageMessage?.originalContentUrl));
    const previewUrl = new URL(String(imageMessage?.previewImageUrl));
    expect(originalUrl.pathname.split("/")[3]).not.toBe(previewUrl.pathname.split("/")[3]);
    expect(app.attachmentRequests).toEqual([ownedImage.name]);

    const address = relay.address()!;
    const originalResponse = await requestRelayMedia(relay, originalUrl.pathname, originalUrl.host);
    expect(originalResponse.statusCode).toBe(200);
    expect(originalResponse.headers["content-type"]).toBe("image/png");
    expect(originalResponse.body).toEqual(ownedImage.bytes);
    const previewResponse = await requestRelayMedia(relay, previewUrl.pathname, previewUrl.host);
    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.headers["content-type"]).toBe("image/png");
    expect(previewResponse.body.byteLength).toBeLessThanOrEqual(1_000_000);
    expect((await requestRelayMedia(relay, `${originalUrl.pathname}?download=1`, originalUrl.host)).statusCode).toBe(404);
    expect((await requestRelayMedia(relay, originalUrl.pathname, "wrong-host.invalid:10000")).statusCode).toBe(404);
    expect((await requestRelayMedia(relay, originalUrl.pathname.replace(/\/original$/, "/preview"), originalUrl.host)).statusCode).toBe(404);
    expect((await requestRelayMedia(relay, originalUrl.pathname, originalUrl.host, "HEAD")).statusCode).toBe(404);
    await relay.close();

    const restarted = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 1000 });
    relays.push(restarted);
    await restarted.start();
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(2);
    expect(sink.requests[1]?.retryKey).toBe(firstRequest.retryKey);
    expect(sink.requests[1]?.body).toEqual(firstRequest.body);
    expect(app.attachmentRequests).toEqual([ownedImage.name]);
    expect((await requestRelayMedia(restarted, originalUrl.pathname, originalUrl.host)).body).toEqual(ownedImage.bytes);
    expect(address.host).toBe("127.0.0.1");
  }, 15_000);

  it("delivers long text batches before the image batch", async () => {
    const app = await makeApp();
    app.finalText = "A".repeat(25_001);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-long-image-test-"));
    tempDirs.push(directory);
    addFixtureImage(app, directory);
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({
      config: config(app.url, join(directory, "relay-state.json"), { publicOrigin: "https://line-relay.fixture.invalid:10000" }),
      fetchImpl,
      pollIntervalMs: 10,
    });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("long-image-event-00000001", "Send the attached image."))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 7000 }).toBe(2);
    const batches = sink.requests.map((request) => linePushBodySchema.parse(request.body).messages);
    expect(batches.map((batch) => batch.map((message) => message.type))).toEqual([
      ["text", "text", "text", "text", "text"],
      ["text", "image"],
    ]);
    expect(batches.flat().filter((message) => message.type === "text").map((message) => message.text).join("")).toBe(app.finalText);
    expect(batches.flat().filter((message) => message.type === "image")).toHaveLength(1);
  }, 12_000);

  it("does not retry a media batch when its persisted cache object is missing", async () => {
    const app = await makeApp();
    const directory = mkdtempSync(join(tmpdir(), "line-relay-missing-cache-test-"));
    tempDirs.push(directory);
    addFixtureImage(app, directory);
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const statePath = join(directory, "relay-state.json");
    const publicOrigin = "https://line-relay.fixture.invalid:10000";
    let loseFirstResponse = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== "api.line.me") return fetch(input, init);
      const response = await fetch(`${sink.url}${url.pathname}`, init);
      if (loseFirstResponse && response.status === 200) {
        loseFirstResponse = false;
        throw new Error("simulated lost LINE response after acceptance");
      }
      return response;
    };
    const relayConfig = config(app.url, statePath, { publicOrigin });
    const relay = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 1000 });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("missing-cache-event-0000001", "Send the attached image."))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);
    const firstRequest = sink.requests[0]!;
    const registryPath = `${statePath}.media/registry.json`;
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
      entries: Record<string, { variant: string; objectName: string }>;
    };
    const original = Object.values(registry.entries).find((entry) => entry.variant === "original");
    expect(original).toBeDefined();
    const objectPath = join(`${statePath}.media`, "objects", original!.objectName);
    rmSync(objectPath);
    await relay.close();

    const restarted = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 10 });
    relays.push(restarted);
    await restarted.start();
    await expect.poll(() => JSON.parse(readFileSync(statePath, "utf8")).records["missing-cache-event-0000001"].state, { timeout: 5000 })
      .toMatchObject({ kind: "manual", reason: "media_unavailable" });
    expect(sink.requests).toHaveLength(1);
    expect(sink.requests[0]).toEqual(firstRequest);
  }, 12_000);

  it("does not silently drop an owned image when the public HTTPS origin is unset", async () => {
    const app = await makeApp();
    const directory = mkdtempSync(join(tmpdir(), "line-relay-media-origin-missing-test-"));
    tempDirs.push(directory);
    addFixtureImage(app, directory);
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const eventId = "media-origin-missing-event-1";
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({
      config: config(app.url, join(directory, "relay-state.json")),
      fetchImpl,
      pollIntervalMs: 10,
    });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event(eventId, "Attach the image."))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);
    const messages = linePushBodySchema.parse(sink.requests[0]?.body).messages;
    expect(messages.every((message) => message.type === "text")).toBe(true);
    expect(sink.deliveries).toEqual(["Final answer from Chief\n\n添付ファイルをLINEに送信できませんでした。OpenMakiBotでタスクの添付を確認してください。"]);
    expect(app.attachmentRequests).toEqual([]);
    const saved = JSON.parse(readFileSync(join(directory, "relay-state.json"), "utf8")) as {
      records: Record<string, { state: { kind: string; reason?: string } }>;
    };
    expect(saved.records[eventId]?.state).toMatchObject({ kind: "manual", reason: "media_unavailable" });
  }, 10_000);

  it("refuses an original attachment above the 10 MB boundary", async () => {
    const app = await makeApp();
    const directory = mkdtempSync(join(tmpdir(), "line-relay-media-oversize-test-"));
    tempDirs.push(directory);
    const name = `${randomUUID()}.png`;
    app.finalAttachments.push({ path: join(directory, "attachments", name), mime: "image/png", bytes: Buffer.alloc(10_000_001) });
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({
      config: config(app.url, join(directory, "relay-state.json"), { publicOrigin: "https://line-relay.fixture.invalid:10000" }),
      fetchImpl,
      pollIntervalMs: 10,
    });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("image-oversize-event-00001", "Send the attached image."))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);
    expect(linePushBodySchema.parse(sink.requests[0]?.body).messages.every((message) => message.type === "text")).toBe(true);
    expect(sink.deliveries.at(-1)).toContain("添付ファイルをLINEに送信できませんでした");
    expect(app.attachmentRequests).toEqual([name]);
  }, 10_000);

  it("formats a table final as one Flex message at the LINE push boundary", async () => {
    const app = await makeApp();
    app.finalText = [
      "Progress summary.",
      "",
      "| Task | Owner |",
      "| --- | --- |",
      "| Deploy | Ada |",
      "",
      "All checks passed.",
    ].join("\n");
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-flex-push-test-"));
    tempDirs.push(directory);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({
      config: config(app.url, join(directory, "relay-state.json")),
      fetchImpl,
      pollIntervalMs: 10,
    });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("flex-push-event-00000001", "Review the table reply."))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);

    const payload = linePushBodySchema.parse(sink.requests[0]?.body);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({
      type: "flex",
      altText: "表形式の内容を縦型カードで表示",
      contents: { type: "bubble" },
    });
    expect(sink.deliveries).toEqual([]);
  }, 10_000);

  it("refuses to start when the configured mode differs from the dedicated task", async () => {
    const app = await makeApp("ask");
    servers.push(app.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-mode-mismatch-test-"));
    tempDirs.push(directory);
    const relay = createLineRelay({
      config: config(app.url, join(directory, "relay-state.json"), { approvalMode: "full" }),
    });
    relays.push(relay);

    await expect(relay.start()).rejects.toThrow("The configured Chief task must use Full approval mode");
    expect(app.expectedApprovalModes).toEqual(["full"]);
    expect(app.posts).toEqual([]);
    expect(relay.address()).toBeNull();
  });

  it("keeps the relay state binding when the operator changes approval mode", async () => {
    const app = await makeApp("ask");
    servers.push(app.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-mode-binding-test-"));
    tempDirs.push(directory);
    const statePath = join(directory, "relay-state.json");
    const askRelay = createLineRelay({ config: config(app.url, statePath) });
    relays.push(askRelay);
    await askRelay.start();
    await askRelay.close();

    app.approvalMode = "full";
    const fullRelay = createLineRelay({ config: config(app.url, statePath, { approvalMode: "full" }) });
    relays.push(fullRelay);
    await fullRelay.start();

    expect(app.expectedApprovalModes).toEqual(["ask", "full"]);
    expect(fullRelay.address()).not.toBeNull();
  });

  it("keeps the state lock through an in-flight startup check when close is requested", async () => {
    const app = await makeApp();
    servers.push(app.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-start-close-test-"));
    tempDirs.push(directory);
    const statePath = join(directory, "relay-state.json");
    let releaseProbe: (() => void) | undefined;
    let reportProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => { releaseProbe = resolve; });
    const probeStarted = new Promise<void>((resolve) => { reportProbe = resolve; });
    const requestedPaths: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
      if (url.pathname === "/api/health") {
        reportProbe?.();
        await probeGate;
      }
      return fetch(input, init);
    };
    const configValue = config(app.url, statePath);
    const starting = createLineRelay({ config: configValue, fetchImpl });
    relays.push(starting);
    const startPromise = starting.start();
    await probeStarted;

    const closePromise = starting.close();
    const contender = createLineRelay({ config: configValue, fetchImpl });
    relays.push(contender);
    await expect(contender.start()).rejects.toThrow("already owned by another live process");

    releaseProbe?.();
    await expect(startPromise).rejects.toThrow("closed");
    await closePromise;
    expect(starting.address()).toBeNull();
    expect(requestedPaths).toEqual(["/api/health"]);

    const replacement = createLineRelay({ config: configValue, fetchImpl: fetch });
    relays.push(replacement);
    await replacement.start();
    expect(replacement.address()).not.toBeNull();
  }, 10_000);

  it("retries a confirmed busy Chief task without changing the send ID", async () => {
    const app = await makeApp();
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    app.busyOnce = true;
    const directory = mkdtempSync(join(tmpdir(), "line-relay-busy-test-"));
    tempDirs.push(directory);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({ config: config(app.url, join(directory, "relay-state.json")), fetchImpl, pollIntervalMs: 10 });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("busy-event-00000001", "wait for the Chief"))).status).toBe(200);
    await expect.poll(() => sink.deliveries.length, { timeout: 5000 }).toBe(1);
    expect(app.posts).toHaveLength(1);
    const attemptedIds = sink.requests.map((request) => request.retryKey);
    expect(new Set(attemptedIds).size).toBe(1);
    const health = await fetch(`http://${relay.address()?.host}:${relay.address()?.port}/health`).then((response) => response.json()) as { manual: number; queued: number };
    expect(health).toEqual({ ok: true, queued: 0, manual: 0 });
    expect(sink.deliveries).toEqual(["Final answer from Chief"]);
  }, 10_000);

  it("keeps a persisted event pending across a temporary app 503", async () => {
    const app = await makeApp();
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-503-test-"));
    tempDirs.push(directory);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({ config: config(app.url, join(directory, "relay-state.json")), fetchImpl, pollIntervalMs: 10 });
    relays.push(relay);
    await relay.start();
    app.bot503Once = true;

    expect((await signedWebhook(relay, event("temporary-503-event-1", "Retry after temporary outage"))).status).toBe(200);
    await expect.poll(() => sink.deliveries.length, { timeout: 5000 }).toBe(1);
    expect(app.botChecks).toBeGreaterThanOrEqual(3);
    expect(app.posts).toHaveLength(1);
    expect(sink.deliveries).toEqual(["Final answer from Chief"]);
  }, 10_000);

  it("does not acknowledge or dispatch an event when durable persistence fails", async () => {
    const app = await makeApp();
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-persist-test-"));
    tempDirs.push(directory);
    const statePath = join(directory, "relay-state.json");
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({ config: config(app.url, statePath), fetchImpl, pollIntervalMs: 10 });
    relays.push(relay);
    await relay.start();
    rmSync(statePath);
    mkdirSync(statePath);

    const inbound = event("persist-failure-event-1", "Do not lose this event");
    expect((await signedWebhook(relay, inbound)).status).toBe(500);
    expect(app.posts).toHaveLength(0);
    expect(sink.requests).toHaveLength(0);

    rmSync(statePath, { recursive: true, force: true });
    expect((await signedWebhook(relay, inbound)).status).toBe(200);
    await expect.poll(() => sink.deliveries.length, { timeout: 5000 }).toBe(1);
    expect(app.posts).toHaveLength(1);
    expect(sink.deliveries).toEqual(["Final answer from Chief"]);
  }, 10_000);

  it("keeps push recipient and payload fixed across a lost response and LINE retry receipt", async () => {
    const app = await makeApp();
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    app.finalText = [
      "Progress summary.",
      "",
      "| Task | Owner |",
      "| --- | --- |",
      "| Deploy | Ada |",
    ].join("\n");
    const directory = mkdtempSync(join(tmpdir(), "line-relay-retry-test-"));
    tempDirs.push(directory);
    const statePath = join(directory, "relay-state.json");
    let loseFirst = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== "api.line.me") return fetch(input, init);
      const response = await fetch(`${sink.url}${url.pathname}`, init);
      if (loseFirst && response.status === 200) {
        loseFirst = false;
        throw new Error("simulated lost LINE response");
      }
      return response;
    };
    const relayConfig = config(app.url, statePath);
    const relay = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 1000 });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("push-retry-event-1", "Send once"))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);
    const firstRequest = sink.requests[0];
    expect(linePushBodySchema.parse(firstRequest?.body).messages[0]).toMatchObject({ type: "flex" });
    await relay.close();

    const restarted = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 1000 });
    relays.push(restarted);
    await restarted.start();
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(2);
    expect(sink.requests[1]?.retryKey).toBe(firstRequest?.retryKey);
    expect(sink.requests[1]?.body).toEqual(firstRequest?.body);
    expect(sink.deliveries).toEqual([]);
  }, 10_000);

  it("retries a legacy pending outbox as the same plain-text body and retry key after restart", async () => {
    const app = await makeApp();
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-legacy-outbox-test-"));
    tempDirs.push(directory);
    const statePath = join(directory, "relay-state.json");
    const retryKey = "00000000-0000-4000-8000-000000000001";
    const tableText = [
      "Progress summary.",
      "",
      "| Task | Owner |",
      "| --- | --- |",
      "| Deploy | Ada |",
    ].join("\n");
    const now = Date.now();
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      binding: { appUrl: app.url, userId: USER_ID, botId: BOT_ID, threadId: THREAD_ID },
      nextSequence: 2,
      records: {
        "legacy-outbox-event": {
          eventId: "legacy-outbox-event",
          digest: "a".repeat(64),
          sequence: 1,
          receivedAt: now,
          eventTimestamp: now,
          sourceUserId: USER_ID,
          text: tableText,
          sendId: `line-${"b".repeat(64)}`,
          state: {
            kind: "outbox",
            recipient: USER_ID,
            batches: [{ retryKey, messages: [tableText] }],
            batchIndex: 0,
            createdAt: now,
            requiresTarget: false,
            resume: { kind: "completed" },
          },
        },
      },
    }), { mode: 0o600 });

    let loseFirst = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== "api.line.me") return fetch(input, init);
      const response = await fetch(`${sink.url}${url.pathname}`, init);
      if (loseFirst && response.status === 200) {
        loseFirst = false;
        throw new Error("simulated lost LINE response");
      }
      return response;
    };
    const relayConfig = config(app.url, statePath);
    const relay = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 1000 });
    relays.push(relay);
    await relay.start();
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(1);
    const firstRequest = sink.requests[0];
    const expectedBody = { to: USER_ID, messages: [{ type: "text", text: tableText }] };
    expect(firstRequest?.retryKey).toBe(retryKey);
    expect(firstRequest?.body).toEqual(expectedBody);
    await relay.close();

    const restarted = createLineRelay({ config: relayConfig, fetchImpl, pollIntervalMs: 1000 });
    relays.push(restarted);
    await restarted.start();
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(2);
    expect(sink.requests[1]?.retryKey).toBe(retryKey);
    expect(sink.requests[1]?.body).toEqual(expectedBody);
    expect(sink.deliveries).toEqual([tableText]);
  }, 10_000);

  it("chunks long replies by UTF-16 code units without splitting supplementary characters", async () => {
    const app = await makeApp();
    const sink = await makeSink();
    servers.push(app.server, sink.server);
    app.finalText = "😀".repeat(2501);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-utf16-test-"));
    tempDirs.push(directory);
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return url.hostname === "api.line.me" ? fetch(`${sink.url}${url.pathname}`, init) : fetch(input, init);
    };
    const relay = createLineRelay({ config: config(app.url, join(directory, "relay-state.json")), fetchImpl, pollIntervalMs: 10 });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("utf16-event-00000001", "Send the long reply"))).status).toBe(200);
    await expect.poll(() => sink.deliveries.join(""), { timeout: 5000 }).toBe(app.finalText);
    expect(sink.deliveries).toHaveLength(2);
    expect(sink.deliveries.every((batch) => batch.length <= 5000)).toBe(true);
    expect(sink.deliveries).toEqual(["😀".repeat(2500), "😀"]);
    expect(sink.deliveries.map((batch) => Array.from(batch).join("")).join("")).toBe(app.finalText);
  }, 10_000);

  it("rejects an oversized webhook before the sender finishes uploading its body", async () => {
    const app = await makeApp();
    servers.push(app.server);
    const directory = mkdtempSync(join(tmpdir(), "line-relay-oversize-test-"));
    tempDirs.push(directory);
    const relay = createLineRelay({ config: config(app.url, join(directory, "relay-state.json")) });
    relays.push(relay);
    await relay.start();
    const address = relay.address();
    if (!address) throw new Error("relay did not start");

    const responseInfo = await new Promise<{ status: number; connection: string | undefined }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("relay did not reject the oversized body promptly")), 5000);
      const request = httpRequest({ hostname: address.host, port: address.port, path: "/webhook", method: "POST" }, (response) => {
        clearTimeout(timeout);
        response.resume();
        resolve({ status: response.statusCode ?? 0, connection: response.headers.connection });
      });
      request.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      request.write(Buffer.alloc(300 * 1024, 0x61));
    });
    expect(responseInfo).toEqual({ status: 413, connection: "close" });
  }, 10_000);

  it("rejects non-loopback configuration without echoing credentials", () => {
    const secret = "do-not-print-this-secret";
    expect(() => lineRelayConfigFromEnv({
      OMB_LINE_APP_URL: "https://app.example.com",
      OMB_LINE_USER_ID: USER_ID,
      OMB_LINE_BOT_ID: BOT_ID,
      OMB_LINE_THREAD_ID: THREAD_ID,
      OMB_LINE_STATE_PATH: join(tmpdir(), "relay-state.json"),
      OMB_LINE_CHANNEL_SECRET: secret,
      OMB_LINE_CHANNEL_ACCESS_TOKEN: TOKEN,
    })).toThrow("appUrl");
    try {
      lineRelayConfigFromEnv({
        OMB_LINE_APP_URL: "https://app.example.com",
        OMB_LINE_USER_ID: USER_ID,
        OMB_LINE_BOT_ID: BOT_ID,
        OMB_LINE_THREAD_ID: THREAD_ID,
        OMB_LINE_STATE_PATH: join(tmpdir(), "relay-state.json"),
        OMB_LINE_CHANNEL_SECRET: secret,
        OMB_LINE_CHANNEL_ACCESS_TOKEN: TOKEN,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("defaults to Ask and rejects unsupported approval modes from the environment", () => {
    const env = {
      OMB_LINE_APP_URL: "http://127.0.0.1:8799",
      OMB_LINE_USER_ID: USER_ID,
      OMB_LINE_BOT_ID: BOT_ID,
      OMB_LINE_THREAD_ID: THREAD_ID,
      OMB_LINE_STATE_PATH: join(tmpdir(), "relay-state.json"),
      OMB_LINE_CHANNEL_SECRET: SECRET,
      OMB_LINE_CHANNEL_ACCESS_TOKEN: TOKEN,
    };

    expect(lineRelayConfigFromEnv(env).approvalMode).toBe("ask");
    expect(lineRelayConfigFromEnv(env).publicOrigin).toBeUndefined();
    expect(lineRelayConfigFromEnv({ ...env, OMB_LINE_APPROVAL_MODE: "full" }).approvalMode).toBe("full");
    expect(() => lineRelayConfigFromEnv({ ...env, OMB_LINE_APPROVAL_MODE: "automatic" })).toThrow("approvalMode");
    expect(lineRelayConfigFromEnv({ ...env, OMB_LINE_PUBLIC_ORIGIN: "https://media.example.test/" }).publicOrigin).toBe("https://media.example.test");
    expect(() => lineRelayConfigFromEnv({ ...env, OMB_LINE_PUBLIC_ORIGIN: "http://media.example.test" })).toThrow("publicOrigin");
    expect(() => lineRelayConfigFromEnv({ ...env, OMB_LINE_PUBLIC_ORIGIN: "https://media.example.test/path" })).toThrow("publicOrigin");
    expect(() => lineRelayConfigFromEnv({ ...env, OMB_LINE_PUBLIC_ORIGIN: "https://user@media.example.test" })).toThrow("publicOrigin");
  });
});
