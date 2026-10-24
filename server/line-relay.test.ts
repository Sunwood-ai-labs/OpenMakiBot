import { createHmac } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createLineRelay, lineRelayConfigFromEnv, type LineRelay, type LineRelayConfig } from "./line-relay.ts";

const USER_ID = `U${"a".repeat(32)}`;
const SECRET = "fixture-channel-secret";
const TOKEN = "fixture-access-token";
const BOT_ID = "bot-chief";
const THREAD_ID = "thread-dedicated";

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
  finalText: string;
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

async function makeApp(): Promise<AppFixture> {
  const fixture: AppFixture = {
    url: "", server: createServer(), posts: [], currentLeaf: null, busyOnce: false,
    bot503Once: false, botChecks: 0, finalText: "Final answer from Chief",
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
      if (req.method === "POST" && url.pathname === `/api/bots/${BOT_ID}/messages/guarded`) {
        const body = await readBody(req) as Record<string, unknown> | null;
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
        sendJson(res, 200, {
          messageId,
          activeLeafId: "final-leaf",
          phase: "settled",
          messages: [
            { id: messageId, role: "user", kind: "text", sendId, requestPending: false },
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
      const body = await readBody(req) as { to?: string; messages?: Array<{ type: string; text: string }> } | null;
      const retryKey = typeof req.headers["x-line-retry-key"] === "string" ? req.headers["x-line-retry-key"] : undefined;
      fixture.requests.push({ retryKey, body });
      const acceptedId = retryKey ? fixture.accepted.get(retryKey) : undefined;
      if (acceptedId) {
        sendJson(res, 409, { message: "The retry key is already accepted" }, { "x-line-accepted-request-id": acceptedId });
        return;
      }
      const requestId = `line-request-${fixture.accepted.size + 1}`;
      if (retryKey) fixture.accepted.set(retryKey, requestId);
      for (const message of body?.messages ?? []) fixture.deliveries.push(message.text);
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
    const directory = mkdtempSync(join(tmpdir(), "line-relay-retry-test-"));
    tempDirs.push(directory);
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
    const relay = createLineRelay({ config: config(app.url, join(directory, "relay-state.json")), fetchImpl, pollIntervalMs: 10 });
    relays.push(relay);
    await relay.start();

    expect((await signedWebhook(relay, event("push-retry-event-1", "Send once"))).status).toBe(200);
    await expect.poll(() => sink.requests.length, { timeout: 5000 }).toBe(2);
    expect(sink.requests[1].retryKey).toBe(sink.requests[0].retryKey);
    expect(sink.requests[1].body).toEqual(sink.requests[0].body);
    expect(sink.deliveries).toEqual(["Final answer from Chief"]);
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
});
