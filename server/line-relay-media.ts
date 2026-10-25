import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, join, posix, resolve, win32 } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const MAX_ORIGINAL_IMAGE_BYTES = 10_000_000;
const MAX_PREVIEW_IMAGE_BYTES = 1_000_000;
const DEFAULT_MAX_CACHE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_REGISTRY_ENTRIES = 2_048;
const DEFAULT_MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
const QUEUED_CAPABILITY_RETENTION_MS = 24 * 60 * 60 * 1000;
const SENT_CAPABILITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_SAFETY_MS = 30_000;
const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_RE = new RegExp(`^${UUID_RE.source.slice(1, -1)}\\.(jpg|png)$`, "i");

const imageMimeSchema = z.enum(["image/jpeg", "image/png"]);
const sourceSchema = z.object({
  botId: z.string().min(1).max(120),
  threadId: z.string().min(1).max(120),
  messageId: z.string().min(1).max(120),
  attachmentIndex: z.number().int().nonnegative().max(9),
  requestMessageId: z.string().min(1).max(120),
  turnId: z.string().min(1).max(120),
}).strict();
const capabilityRecordSchema = z.object({
  variant: z.enum(["original", "preview"]),
  source: sourceSchema,
  objectName: z.string().regex(OBJECT_NAME_RE),
  mime: imageMimeSchema,
  bytes: z.number().int().positive().max(MAX_ORIGINAL_IMAGE_BYTES),
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict();
const registrySchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string().regex(/^[a-f0-9]{64}$/), capabilityRecordSchema),
}).strict();

type ImageMime = z.infer<typeof imageMimeSchema>;
type MediaVariant = "original" | "preview";
type SourceRef = z.infer<typeof sourceSchema>;
type CapabilityRecord = z.infer<typeof capabilityRecordSchema>;
type Registry = z.infer<typeof registrySchema>;

export type LineMediaUrls = Readonly<{
  originalContentUrl: string;
  previewImageUrl: string;
}>;

export type LineImageSource = Readonly<{
  bytes: Uint8Array;
  mime: ImageMime;
}>;

export type LineRelayMediaStore = Readonly<{
  load(): Promise<void>;
  registerImage(input: { original: LineImageSource; source: SourceRef; now?: number }): Promise<LineMediaUrls>;
  retainForQueue(urls: readonly string[], expiresAt: number, now?: number): Promise<void>;
  retainForSend(urls: readonly string[], now?: number): Promise<void>;
  cleanup(now?: number): Promise<void>;
  handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}>;

export type LineRelayMediaLimits = Readonly<{
  maxCacheBytes: number;
  maxRegistryEntries: number;
  maxRegistryBytes: number;
}>;

const DEFAULT_LIMITS: LineRelayMediaLimits = {
  maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
  maxRegistryEntries: DEFAULT_MAX_REGISTRY_ENTRIES,
  maxRegistryBytes: DEFAULT_MAX_REGISTRY_BYTES,
};

function hashCapability(token: string): string | null {
  if (!CAPABILITY_TOKEN_RE.test(token)) return null;
  const decoded = Buffer.from(token, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== token) return null;
  return createHash("sha256").update(decoded).digest("hex");
}

function capabilityUrl(publicOrigin: string, token: string, variant: MediaVariant): string {
  return `${publicOrigin}/line/media/${token}/${variant}`;
}

function capabilityFromUrl(value: string, publicOrigin: string): { hash: string; variant: MediaVariant } | null {
  try {
    const url = new URL(value);
    if (url.origin !== publicOrigin || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/line\/media\/([A-Za-z0-9_-]{43})\/(original|preview)$/.exec(url.pathname);
    if (!match) return null;
    const hash = hashCapability(match[1]!);
    return hash ? { hash, variant: match[2] as MediaVariant } : null;
  } catch {
    return null;
  }
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.byteLength >= 24 && bytes.subarray(0, 8).equals(pngSignature) && bytes.toString("ascii", 12, 16) === "IHDR") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  return null;
}

function isImageMagic(bytes: Buffer, mime: ImageMime): boolean {
  if (mime === "image/png") return pngDimensions(bytes) !== null;
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function safeResponse(res: ServerResponse, status: number, bytes?: Buffer, mime?: ImageMime): void {
  const headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (!bytes || !mime) {
    res.writeHead(status, { ...headers, "content-length": "0" });
    res.end();
    return;
  }
  res.writeHead(status, {
    ...headers,
    "content-type": mime,
    "content-length": String(bytes.byteLength),
    "content-disposition": "inline",
  });
  res.end(bytes);
}

async function writeImmutableFile(path: string, bytes: Buffer): Promise<void> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

export function createLineRelayMediaStore(input: {
  directory: string;
  publicOrigin: string;
  limits?: Partial<LineRelayMediaLimits>;
}): LineRelayMediaStore {
  if (!isAbsolute(input.directory)) throw new Error("LINE media directory must be absolute");
  const origin = new URL(input.publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== input.publicOrigin || origin.pathname !== "/" ||
      origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("LINE media public origin must be a fixed HTTPS origin");
  }
  if (input.publicOrigin.length + 80 > 2000) throw new Error("LINE media public origin is too long for image URLs");

  const directory = resolve(input.directory);
  const objectDirectory = join(directory, "objects");
  const registryPath = join(directory, "registry.json");
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("LINE media store limits must be positive safe integers");
  }
  let registry: Registry | null = null;
  let mutationTail = Promise.resolve();

  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const persist = async (next: Registry): Promise<void> => {
    const serialized = `${JSON.stringify(next)}\n`;
    if (Buffer.byteLength(serialized) > limits.maxRegistryBytes) throw new Error("LINE media registry quota is full");
    await writeFileAtomic(registryPath, serialized, { mode: 0o600 });
    await chmod(registryPath, 0o600);
    registry = next;
  };

  const load = (): Promise<void> => mutate(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await mkdir(objectDirectory, { recursive: true, mode: 0o700 });
    await chmod(objectDirectory, 0o700);
    let raw: unknown;
    try {
      const handle = await open(registryPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > limits.maxRegistryBytes) throw new Error("registry size is outside limits");
        raw = JSON.parse(await handle.readFile("utf8"));
      }
      finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("LINE media registry is invalid or unreadable");
      const initial: Registry = { version: 1, entries: {} };
      await persist(initial);
      return;
    }
    const parsed = registrySchema.safeParse(raw);
    if (!parsed.success) throw new Error("LINE media registry does not match the supported schema");
    const totalBytes = Object.values(parsed.data.entries).reduce((sum, record) => sum + record.bytes, 0);
    if (Object.keys(parsed.data.entries).length > limits.maxRegistryEntries || totalBytes > limits.maxCacheBytes) {
      throw new Error("LINE media registry exceeds configured storage limits");
    }
    registry = parsed.data;
    await chmod(registryPath, 0o600);
  });

  const requireRegistry = (): Registry => {
    if (!registry) throw new Error("LINE media store is not loaded");
    return registry;
  };

  const writeObject = async (mime: ImageMime, bytes: Buffer): Promise<string> => {
    const extension = mime === "image/jpeg" ? ".jpg" : ".png";
    const objectName = `${randomUUID()}${extension}`;
    await writeImmutableFile(join(objectDirectory, objectName), bytes);
    return objectName;
  };

  const makeRecord = (variant: MediaVariant, source: SourceRef, objectName: string, mime: ImageMime, bytes: Buffer, width: number, height: number, now: number): CapabilityRecord => ({
    variant,
    source,
    objectName,
    mime,
    bytes: bytes.byteLength,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    createdAt: now,
    expiresAt: now + QUEUED_CAPABILITY_RETENTION_MS,
  });

  const readObject = async (record: CapabilityRecord): Promise<Buffer | null> => {
    const path = join(objectDirectory, record.objectName);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size !== record.bytes) return null;
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== record.bytes) return null;
        const bytes = await handle.readFile();
        if (bytes.byteLength !== record.bytes || !isImageMagic(bytes, record.mime) ||
            createHash("sha256").update(bytes).digest("hex") !== record.sha256) return null;
        return bytes;
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  };

  const cleanup = (now = Date.now()): Promise<void> => mutate(async () => {
    const current = requireRegistry();
    const entries = Object.fromEntries(Object.entries(current.entries).filter(([, record]) => record.expiresAt > now));
    const retainedNames = new Set(Object.values(entries).map((record) => record.objectName));
    const changed = Object.keys(entries).length !== Object.keys(current.entries).length;
    if (changed) await persist({ version: 1, entries });
    let files: Dirent[];
    try { files = await readdir(objectDirectory, { withFileTypes: true }); }
    catch { return; }
    for (const file of files) {
      if (!file.isFile() || !OBJECT_NAME_RE.test(file.name) || retainedNames.has(file.name)) continue;
      await unlink(join(objectDirectory, file.name)).catch(() => undefined);
    }
  });

  return {
    load,
    async registerImage({ original, source, now = Date.now() }) {
      if (!registry) throw new Error("LINE media store is not loaded");
      source = sourceSchema.parse(source);
      await cleanup(now);
      const originalBytes = Buffer.from(original.bytes);
      if (originalBytes.byteLength <= 0 || originalBytes.byteLength > MAX_ORIGINAL_IMAGE_BYTES ||
          !imageMimeSchema.safeParse(original.mime).success || !isImageMagic(originalBytes, original.mime)) {
        throw new Error("LINE image source is invalid or outside size limits");
      }
      const { createLineImagePreview } = await import("./line-image-preview.ts");
      const preview = createLineImagePreview(originalBytes, original.mime);
      const originalWidth = preview.sourceWidth;
      const originalHeight = preview.sourceHeight;
      if (!Number.isSafeInteger(originalWidth) || !Number.isSafeInteger(originalHeight) || originalWidth < 1 || originalHeight < 1 ||
          originalWidth > 16_384 || originalHeight > 16_384 || originalWidth * originalHeight > 40_000_000) {
        throw new Error("LINE image source dimensions are outside limits");
      }
      const previewBytes = Buffer.from(preview.bytes);
      if (preview.mime !== "image/png" || previewBytes.byteLength <= 0 || previewBytes.byteLength > MAX_PREVIEW_IMAGE_BYTES ||
          !isImageMagic(previewBytes, "image/png") || !Number.isSafeInteger(preview.width) || !Number.isSafeInteger(preview.height) ||
          preview.width < 1 || preview.height < 1 || preview.width > 640 || preview.height > 640 ||
          preview.width * preview.height > 40_000_000 || pngDimensions(previewBytes)?.width !== preview.width ||
          pngDimensions(previewBytes)?.height !== preview.height) {
        throw new Error("LINE image preview is invalid or outside size limits");
      }

      return mutate(async () => {
        const current = requireRegistry();
        const usedBytes = Object.values(current.entries).reduce((sum, record) => sum + record.bytes, 0);
        if (Object.keys(current.entries).length + 2 > limits.maxRegistryEntries ||
            usedBytes + originalBytes.byteLength + previewBytes.byteLength > limits.maxCacheBytes) {
          throw new Error("LINE media cache quota is full");
        }
        const originalName = await writeObject(original.mime, originalBytes);
        let previewName: string | null = null;
        try {
          previewName = await writeObject(preview.mime, previewBytes);
          const originalToken = randomBytes(32).toString("base64url");
          const previewToken = randomBytes(32).toString("base64url");
          const originalHash = hashCapability(originalToken)!;
          const previewHash = hashCapability(previewToken)!;
          if (current.entries[originalHash] || current.entries[previewHash] || originalHash === previewHash) {
            throw new Error("LINE media capability collision");
          }
          const entries = {
            ...current.entries,
            [originalHash]: makeRecord("original", source, originalName, original.mime, originalBytes, originalWidth, originalHeight, now),
            [previewHash]: makeRecord("preview", source, previewName, preview.mime, previewBytes, preview.width, preview.height, now),
          };
          const next: Registry = { version: 1, entries };
          if (Buffer.byteLength(`${JSON.stringify(next)}\n`) > limits.maxRegistryBytes) {
            throw new Error("LINE media registry quota is full");
          }
          await persist(next);
          return {
            originalContentUrl: capabilityUrl(origin.origin, originalToken, "original"),
            previewImageUrl: capabilityUrl(origin.origin, previewToken, "preview"),
          };
        } catch (error) {
          await unlink(join(objectDirectory, originalName)).catch(() => undefined);
          if (previewName) await unlink(join(objectDirectory, previewName)).catch(() => undefined);
          throw error;
        }
      });
    },
    async retainForQueue(urls, expiresAt, now = Date.now()) {
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new Error("LINE media queue expiry is invalid");
      await mutate(async () => {
        const current = requireRegistry();
        const hashes = new Set<string>();
        for (const value of urls) {
          const capability = capabilityFromUrl(value, origin.origin);
          if (!capability) throw new Error("LINE media payload contains an invalid capability URL");
          const record = current.entries[capability.hash];
          if (!record || record.variant !== capability.variant || record.expiresAt <= now) {
            throw new Error("LINE media capability is unavailable for the queued payload");
          }
          if (!await readObject(record)) throw new Error("LINE media cache object is missing or invalid");
          hashes.add(capability.hash);
        }
        if (hashes.size === 0) throw new Error("LINE media queue has no capabilities");
        const entries = { ...current.entries };
        for (const hash of hashes) entries[hash] = { ...entries[hash]!, expiresAt: Math.max(entries[hash]!.expiresAt, expiresAt) };
        await persist({ version: 1, entries });
      });
    },
    async retainForSend(urls, now = Date.now()) {
      await mutate(async () => {
        const current = requireRegistry();
        const hashes = new Set<string>();
        for (const value of urls) {
          const capability = capabilityFromUrl(value, origin.origin);
          if (!capability) throw new Error("LINE media payload contains an invalid capability URL");
          const record = current.entries[capability.hash];
          if (!record || record.variant !== capability.variant || record.expiresAt <= now) {
            throw new Error("LINE media capability is unavailable for the queued payload");
          }
          if (!await readObject(record)) throw new Error("LINE media cache object is missing or invalid");
          hashes.add(capability.hash);
        }
        if (hashes.size === 0) return;
        const entries = { ...current.entries };
        const expiresAt = now + SENT_CAPABILITY_RETENTION_MS + SEND_TIMEOUT_SAFETY_MS;
        for (const hash of hashes) entries[hash] = { ...entries[hash]!, expiresAt: Math.max(entries[hash]!.expiresAt, expiresAt) };
        await persist({ version: 1, entries });
      });
    },
    cleanup,
    async handleHttpRequest(req, res) {
      const rawUrl = req.url ?? "";
      if (!rawUrl.startsWith("/line/media")) return false;
      const match = /^\/line\/media\/([A-Za-z0-9_-]{43})\/(original|preview)$/.exec(rawUrl);
      if (req.method !== "GET" || !match || req.headers.host?.toLowerCase() !== origin.host.toLowerCase()) {
        safeResponse(res, 404);
        return true;
      }
      const hash = hashCapability(match[1]!);
      const variant = match[2] as MediaVariant;
      const record = hash ? registry?.entries[hash] : undefined;
      if (!record || record.variant !== variant || record.expiresAt <= Date.now()) {
        safeResponse(res, 404);
        return true;
      }
      const bytes = await readObject(record);
      safeResponse(res, bytes ? 200 : 404, bytes ?? undefined, bytes ? record.mime : undefined);
      return true;
    },
  };
}

export function lineImageAttachmentName(input: { path: string; mime: string }): string | null {
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(input.path) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(input.path);
  const pathApi = windowsAbsolute ? win32 : posix.isAbsolute(input.path) ? posix : null;
  if (!pathApi || pathApi.normalize(input.path) !== input.path) return null;
  const name = pathApi.basename(input.path);
  const extension = pathApi.extname(name).toLowerCase();
  if (pathApi.basename(pathApi.dirname(input.path)).toLowerCase() !== "attachments" || !UUID_RE.test(name.slice(0, -extension.length))) return null;
  if (input.mime === "image/jpeg" && extension === ".jpg") return name;
  if (input.mime === "image/png" && extension === ".png") return name;
  return null;
}
