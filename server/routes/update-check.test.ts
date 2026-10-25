import { createServer, get as httpGet, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverVersion } from "../environment.ts";
import { json, readBody } from "../harness/http.ts";
import { SERVER_ROOT } from "../proxy-paths.ts";
import { requiredScope } from "../request-auth.ts";
import { installKind, type UpdateCheck } from "../update-check.ts";
import { dispatchRoutes } from "./table.ts";
import { createUpdateCheckRoutes, serverUpdateChecker } from "./update-check.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(check: () => Promise<UpdateCheck>): Promise<string> {
  const routes = [createUpdateCheckRoutes({ check })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin"] }, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function getJson(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      response.setEncoding("utf8");
      let text = "";
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("end", () => {
        try {
          const body: unknown = JSON.parse(text);
          resolve({ status: response.statusCode ?? 0, body });
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    }).on("error", reject);
  });
}

describe("update check route", () => {
  it("is open to chat-only sessions: it only reads a version", () => {
    expect(requiredScope("GET", "/api/updates/check")).toBe("client");
  });

  it("answers with the check, and leaves other requests to the next handler", async () => {
    const result: UpdateCheck = { current: "0.1.92", install: "docker", latest: "0.1.93", available: true };
    const base = await serve(async () => result);
    const response = await fetch(`${base}/api/updates/check`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect((await fetch(`${base}/api/updates/check`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/api/updates`)).status).toBe(404);
  });

  it("does not expose the upstream release feed as an OpenMakiBot update", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected release-feed request"));
    try {
      const where = { desktopManaged: false, managed: false };
      const base = await serve(serverUpdateChecker(where));
      const response = await getJson(`${base}/api/updates/check`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        current: serverVersion(),
        install: installKind({ ...where, serverRoot: SERVER_ROOT }),
        available: false,
      });
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      upstreamFetch.mockRestore();
    }
  });

  it("reports a failed lookup as a 502 with the reason", async () => {
    const base = await serve(async () => { throw new Error("GitHub answered 403"); });
    const response = await fetch(`${base}/api/updates/check`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Could not check for updates: GitHub answered 403" });
  });
});
