import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const repoRoot = resolve(process.env.OMB_PROFILE_FIXTURE_REPO?.trim() || "/upstream");
const staticDir = resolve(process.env.STATIC_DIR?.trim() || join(repoRoot, "dist"));
const port = 18_891;
const webhookPort = 18_892;
const owner = { name: "Workspace Owner", email: "owner@example.test" };
const memberEmail = "member.one@example.test";

if (!existsSync(join(repoRoot, "server", "index.ts"))) {
  throw new Error("run this fixture in the upstream builder or set OMB_PROFILE_FIXTURE_REPO");
}
if (!existsSync(join(staticDir, "index.html"))) {
  throw new Error("STATIC_DIR must contain the production index.html");
}

await import(pathToFileURL(join(repoRoot, "server", "testing", "scrub-ambient-omb-env.ts")).href);
const [controlOmb, controlPlane, cleanup, ports] = await Promise.all([
  import(pathToFileURL(join(repoRoot, "scripts", "control-omb.ts")).href),
  import(pathToFileURL(join(repoRoot, "server", "testing", "control-plane-stub.ts")).href),
  import(pathToFileURL(join(repoRoot, "server", "testing", "cleanup.ts")).href),
  import(pathToFileURL(join(repoRoot, "server", "testing", "ports.ts")).href),
]);

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function genericAvatarPng(): Buffer {
  const width = 32;
  const height = 32;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const offset = row + 1 + x * 4;
      if (dx * dx + dy * dy > 225) continue;
      const head = (x - 15.5) ** 2 + (y - 10.5) ** 2 <= 25;
      const shoulders = y >= 18 && ((x - 15.5) ** 2) / 100 + ((y - 25) ** 2) / 49 <= 1;
      pixels[offset] = head || shoulders ? 245 : 54;
      pixels[offset + 1] = head || shoulders ? 248 : 112;
      pixels[offset + 2] = head || shoulders ? 250 : 171;
      pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

let dataDir: string | undefined;
let stub: { url: string; otp: string; close(): Promise<void> } | undefined;
let child: ChildProcess | undefined;
let childError: Error | undefined;
let stopRequested = false;
let requestStop = () => {};
const stopped = new Promise<void>((resolveStop) => { requestStop = resolveStop; });
const onSignal = () => {
  if (stopRequested) return;
  stopRequested = true;
  requestStop();
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (childError) throw new Error(`fixture server could not start: ${childError.message}`);
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error("fixture server exited during startup");
    if (child?.signalCode) throw new Error("fixture server exited during startup");
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && (await response.json() as { app?: string }).app === "openmausbot") return;
    } catch {
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error("fixture server did not become ready");
}

async function api(url: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${path}`, {
    ...init,
    headers: { origin: url, ...(init.headers ?? {}) },
  });
}

try {
  await ports.freePortBlock([0, 1], port, 1);
  dataDir = mkdtempSync(join(tmpdir(), "omb-native-profile-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  const attachmentId = randomUUID();
  const avatarUrl = `/api/attachments/${attachmentId}.png`;
  mkdirSync(join(dataDir, "attachments"), { recursive: true });
  writeFileSync(join(dataDir, "attachments", `${attachmentId}.png`), genericAvatarPng(), { mode: 0o600 });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    instances: {
      claude: {
        driver: "claudeAgent",
        displayName: "Native profile fixture engine",
        config: { cli: join(repoRoot, "server", "testing", "fake-claude-cli.ts") },
      },
    },
    profile: { ...owner, avatarUrl },
    signIn: { admins: [owner.email], members: [memberEmail] },
  }, null, 2));
  stub = await controlPlane.startControlPlaneStub();
  const url = `http://127.0.0.1:${port}`;
  const childEnv = controlOmb.verificationServerEnvironment({ OMB_DEV_TRUST_LOCAL_BROWSER: "0" }, dataDir, port);
  Object.assign(childEnv, {
    OMB_CONTROL_PLANE_URL: stub.url,
    OMB_PUBLIC_URL: url,
    OMB_ENVIRONMENT_LABEL: "Native profile fixture",
    OMB_BROWSER_CONNECTION: join(dataDir, "browser-test-connection.json"),
    OMB_STATIC_DIR: staticDir,
    OMB_WEBHOOK_PORT: String(webhookPort),
    OMB_DEV_TRUST_LOCAL_BROWSER: "0",
  });
  child = spawn(process.execPath, controlOmb.verificationServerArgs(childEnv), {
    cwd: repoRoot,
    env: childEnv,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    childError = error;
    requestStop();
  });
  child.on("close", () => requestStop());
  await waitForServer(url);

  const descriptor = await fetch(`${url}/.well-known/openmausbot/environment`);
  const descriptorBody = await descriptor.json() as { capabilities?: { emailSignIn?: boolean } };
  if (!descriptor.ok || descriptorBody.capabilities?.emailSignIn !== true) {
    throw new Error("native email sign-in is not enabled in the fixture");
  }
  const bots = await api(url, "/api/bots");
  const botBody = await bots.json() as { bots?: Array<{ id: string }> };
  if (!bots.ok || botBody.bots?.length !== 1) throw new Error("fixture server did not seed its starter bot");
  const renamed = await api(url, `/api/bots/${botBody.bots[0]!.id}/profile`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Fixture Starter" }),
  });
  if (!renamed.ok) throw new Error("fixture starter bot could not be named");

  console.log(JSON.stringify({ url: `${url}/pair?email=${encodeURIComponent(memberEmail)}`, otp: stub.otp }));
  await stopped;
} finally {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  if (child) await cleanup.waitForExit(child, { signal: "SIGTERM" });
  await stub?.close();
  if (dataDir) await cleanup.removeTempDir(dataDir);
}
