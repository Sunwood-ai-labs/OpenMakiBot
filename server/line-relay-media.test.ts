import { randomUUID } from "node:crypto";
import { request as httpRequest, createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdtempSync, readdirSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { afterEach, describe, expect, it } from "vitest";
import { createLineRelayMediaStore, lineImageAttachmentName, type LineRelayMediaStore } from "./line-relay-media.ts";

const PUBLIC_ORIGIN = "https://line-media.fixture.invalid:10000";
const SOURCE = {
  botId: "bot-chief",
  threadId: "thread-dedicated",
  messageId: "message-with-image",
  attachmentIndex: 0,
  requestMessageId: "line-request-message",
  turnId: "turn-successful",
};
const sourcePng = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#345678"/></svg>').render().asPng());
const directories: string[] = [];
const servers: Server[] = [];

type RouteResponse = { statusCode: number | undefined; headers: IncomingHttpHeaders; body: Buffer };

async function startServer(store: LineRelayMediaStore): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void store.handleHttpRequest(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404, { "content-length": "0" });
        res.end();
      }
    }).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-length": "0" });
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("media fixture did not bind");
  servers.push(server);
  return { server, port: address.port };
}

function requestRoute(port: number, path: string, host: string, method = "GET"): Promise<RouteResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method, headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once("error", reject);
      response.once("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    request.end();
  });
}

function makeStore(directory: string, limits?: Parameters<typeof createLineRelayMediaStore>[0]["limits"]): LineRelayMediaStore {
  return createLineRelayMediaStore({ directory, publicOrigin: PUBLIC_ORIGIN, limits });
}

async function register(store: LineRelayMediaStore, now = Date.now()) {
  return store.registerImage({ original: { bytes: sourcePng, mime: "image/png" }, source: SOURCE, now });
}

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "line-relay-media-store-test-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("LINE relay private media store", () => {
  it("serves only the persisted variant-bound capability and survives a store restart", async () => {
    const directory = tempDirectory();
    const storeDirectory = join(directory, "media");
    const store = makeStore(storeDirectory);
    await store.load();
    const urls = await register(store);
    const originalUrl = new URL(urls.originalContentUrl);
    const previewUrl = new URL(urls.previewImageUrl);
    const originalToken = originalUrl.pathname.split("/")[3]!;
    const previewToken = previewUrl.pathname.split("/")[3]!;
    expect(originalToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(previewToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(originalToken).not.toBe(previewToken);

    const registry = readFileSync(join(storeDirectory, "registry.json"), "utf8");
    expect(registry).not.toContain(originalToken);
    expect(registry).not.toContain(previewToken);
    expect(registry).toContain(SOURCE.requestMessageId);
    expect(registry).toContain(SOURCE.turnId);
    if (process.platform !== "win32") {
      expect(statSync(storeDirectory).mode & 0o777).toBe(0o700);
      expect(statSync(join(storeDirectory, "registry.json")).mode & 0o777).toBe(0o600);
      for (const file of readdirSync(join(storeDirectory, "objects"))) {
        expect(statSync(join(storeDirectory, "objects", file)).mode & 0o777).toBe(0o600);
      }
    }

    const first = await startServer(store);
    const original = await requestRoute(first.port, originalUrl.pathname, originalUrl.host);
    expect(original.statusCode).toBe(200);
    expect(original.headers["content-type"]).toBe("image/png");
    expect(original.body).toEqual(sourcePng);
    const preview = await requestRoute(first.port, previewUrl.pathname, previewUrl.host);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toBe("image/png");
    expect(preview.body.byteLength).toBeLessThanOrEqual(1_000_000);
    expect(preview.body).not.toEqual(sourcePng);

    const wrongCapability = Buffer.alloc(32, 0x5a).toString("base64url");
    expect((await requestRoute(first.port, `/line/media/${wrongCapability}/original`, originalUrl.host)).statusCode).toBe(404);
    expect((await requestRoute(first.port, `${originalUrl.pathname}?download=1`, originalUrl.host)).statusCode).toBe(404);
    expect((await requestRoute(first.port, originalUrl.pathname.replace(/\/original$/, "/preview"), originalUrl.host)).statusCode).toBe(404);
    expect((await requestRoute(first.port, originalUrl.pathname, "wrong-host.fixture.invalid:10000")).statusCode).toBe(404);
    expect((await requestRoute(first.port, originalUrl.pathname, originalUrl.host, "HEAD")).statusCode).toBe(404);
    expect((await requestRoute(first.port, "/line/media/../health", originalUrl.host)).statusCode).toBe(404);

    await new Promise<void>((resolve, reject) => first.server.close((error) => error ? reject(error) : resolve()));
    servers.splice(servers.indexOf(first.server), 1);
    const restartedStore = makeStore(storeDirectory);
    await restartedStore.load();
    const restarted = await startServer(restartedStore);
    const afterRestart = await requestRoute(restarted.port, originalUrl.pathname, originalUrl.host);
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.body).toEqual(sourcePng);
  });

  it("keeps queued capabilities through 24 hours, pins accepted media for 30 days, then cleans the files", async () => {
    const directory = tempDirectory();
    const storeDirectory = join(directory, "media");
    const store = makeStore(storeDirectory);
    await store.load();
    const now = Date.now();
    const urls = await register(store, now);
    const originalUrl = new URL(urls.originalContentUrl);
    const queuedUntil = now + 24 * 60 * 60 * 1000 + 5000;
    await store.retainForQueue([urls.originalContentUrl, urls.previewImageUrl], queuedUntil, now);
    await store.cleanup(now + 24 * 60 * 60 * 1000 + 1);
    const queuedServer = await startServer(store);
    expect((await requestRoute(queuedServer.port, originalUrl.pathname, originalUrl.host)).statusCode).toBe(200);
    await new Promise<void>((resolve, reject) => queuedServer.server.close((error) => error ? reject(error) : resolve()));
    servers.splice(servers.indexOf(queuedServer.server), 1);

    await store.retainForSend([urls.originalContentUrl, urls.previewImageUrl], queuedUntil - 1);
    await store.cleanup(queuedUntil + 24 * 60 * 60 * 1000);
    const sentServer = await startServer(store);
    expect((await requestRoute(sentServer.port, originalUrl.pathname, originalUrl.host)).statusCode).toBe(200);
    await store.cleanup(now + 32 * 24 * 60 * 60 * 1000);
    expect((await requestRoute(sentServer.port, originalUrl.pathname, originalUrl.host)).statusCode).toBe(404);
    expect(readdirSync(join(storeDirectory, "objects"))).toEqual([]);
  });

  it("fails closed at cache and registry quotas without evicting existing media", async () => {
    const directory = tempDirectory();
    const storeDirectory = join(directory, "media");
    const store = makeStore(storeDirectory, { maxRegistryEntries: 2 });
    await store.load();
    const firstUrls = await register(store);
    await expect(register(store)).rejects.toThrow("quota is full");
    expect(readdirSync(join(storeDirectory, "objects"))).toHaveLength(2);
    const originalUrl = new URL(firstUrls.originalContentUrl);
    const server = await startServer(store);
    expect((await requestRoute(server.port, originalUrl.pathname, originalUrl.host)).statusCode).toBe(200);

    const limitedDirectory = join(directory, "limited");
    const limited = makeStore(limitedDirectory, { maxRegistryBytes: 100 });
    await limited.load();
    await expect(register(limited)).rejects.toThrow("registry quota is full");
    expect(readdirSync(join(limitedDirectory, "objects"))).toEqual([]);

    const cacheLimitedDirectory = join(directory, "cache-limited");
    const cacheLimited = makeStore(cacheLimitedDirectory, { maxCacheBytes: 1 });
    await cacheLimited.load();
    await expect(register(cacheLimited)).rejects.toThrow("cache quota is full");
    expect(readdirSync(join(cacheLimitedDirectory, "objects"))).toEqual([]);
  });

  it("accepts canonical Windows and POSIX attachment paths without reading either path", () => {
    const id = randomUUID();
    expect(lineImageAttachmentName({ path: `/var/lib/openmaki/attachments/${id}.png`, mime: "image/png" })).toBe(`${id}.png`);
    expect(lineImageAttachmentName({ path: `C:\\OpenMakiBot\\data\\attachments\\${id}.jpg`, mime: "image/jpeg" })).toBe(`${id}.jpg`);
    expect(lineImageAttachmentName({ path: `/var/lib/openmaki/other/${id}.png`, mime: "image/png" })).toBeNull();
    expect(lineImageAttachmentName({ path: `/var/lib/openmaki/attachments/../attachments/${id}.png`, mime: "image/png" })).toBeNull();
    expect(lineImageAttachmentName({ path: `/var/lib/openmaki/attachments/${id}.jpg`, mime: "image/png" })).toBeNull();
    expect(lineImageAttachmentName({ path: `file:///var/lib/openmaki/attachments/${id}.png`, mime: "image/png" })).toBeNull();
  });
});
