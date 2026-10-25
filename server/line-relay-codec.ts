import { randomUUID } from "node:crypto";
import { z } from "zod";
import { formatLineMessage, type LineMessage } from "./line-message-format.ts";
import { lineImageAttachmentName, type LineMediaUrls } from "./line-relay-media.ts";

export const MAX_LINE_TEXT_CODE_UNITS = 5000;

const MAX_LINE_PUSH_MESSAGES = 5;

export const idSchema = z.string().regex(/^[\w-]+$/);

export const userIdSchema = z.string().regex(/^U[0-9a-f]{32}$/i);

export const appUrlSchema = z.string().url().refine((value) => {
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

export const linePublicOriginSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === "/" || url.pathname === "") && new URL(value).origin.length + 80 <= 2000;
  } catch {
    return false;
  }
}, "publicOrigin must be a fixed HTTPS origin").transform((value) => new URL(value).origin);

const bindingSchema = z.object({
  appUrl: appUrlSchema,
  userId: userIdSchema,
  botId: idSchema,
  threadId: idSchema,
}).strict();

const legacyPushBatchSchema = z.object({
  retryKey: z.string().uuid(),
  messages: z.array(z.string().min(1).max(MAX_LINE_TEXT_CODE_UNITS)).min(1).max(5),
  format: z.literal("table-flex-v1").optional(),
}).strict();

const flexSpanSchema = z.object({
  type: z.literal("span"),
  text: z.string().max(MAX_LINE_TEXT_CODE_UNITS),
  weight: z.enum(["regular", "bold"]).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
}).strict();

type PersistedFlexSpan = z.infer<typeof flexSpanSchema>;

type PersistedFlexPlainText = { type: "text"; text: string; wrap: true; size: "md" };

type PersistedFlexSpannedText = { type: "text"; contents: PersistedFlexSpan[]; wrap: true; size: "md" };

type PersistedFlexBox = {
  type: "box";
  layout: "vertical";
  contents: PersistedFlexComponent[];
  spacing?: "sm" | "md";
  paddingAll?: "md";
  backgroundColor?: string;
  cornerRadius?: "md";
};

type PersistedFlexSeparator = { type: "separator"; margin: "sm"; color: string };

type PersistedFlexComponent = PersistedFlexPlainText | PersistedFlexSpannedText | PersistedFlexBox | PersistedFlexSeparator;

const flexComponentSchema: z.ZodType<PersistedFlexComponent> = z.lazy(() => z.union([
  z.object({ type: z.literal("text"), text: z.string().max(MAX_LINE_TEXT_CODE_UNITS), wrap: z.literal(true), size: z.literal("md") }).strict(),
  z.object({ type: z.literal("text"), contents: z.array(flexSpanSchema).max(1000), wrap: z.literal(true), size: z.literal("md") }).strict(),
  z.object({
    type: z.literal("box"),
    layout: z.literal("vertical"),
    contents: z.array(flexComponentSchema).max(50),
    spacing: z.enum(["sm", "md"]).optional(),
    paddingAll: z.literal("md").optional(),
    backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    cornerRadius: z.literal("md").optional(),
  }).strict(),
  z.object({ type: z.literal("separator"), margin: z.literal("sm"), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) }).strict(),
]));

const flexBubbleSchema = z.object({
  type: z.literal("bubble"),
  size: z.literal("mega"),
  body: z.object({
    type: z.literal("box"),
    layout: z.literal("vertical"),
    contents: z.array(flexComponentSchema).max(50),
    spacing: z.enum(["sm", "md"]).optional(),
    paddingAll: z.literal("md").optional(),
    backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    cornerRadius: z.literal("md").optional(),
  }).strict(),
}).strict();

const versionedPushMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(MAX_LINE_TEXT_CODE_UNITS) }).strict(),
  z.object({ type: z.literal("flex"), altText: z.string().min(1).max(400), contents: flexBubbleSchema }).strict(),
  z.object({
    type: z.literal("image"),
    originalContentUrl: z.string().url().max(2000),
    previewImageUrl: z.string().url().max(2000),
  }).strict(),
]);

const versionedPushPayloadSchema = z.object({
  version: z.literal(1),
  publicOrigin: linePublicOriginSchema,
  messages: z.array(versionedPushMessageSchema).min(1).max(MAX_LINE_PUSH_MESSAGES),
}).strict();

const versionedPushBatchSchema = z.object({
  retryKey: z.string().uuid(),
  payload: versionedPushPayloadSchema,
}).strict();

const pushBatchSchema = z.union([legacyPushBatchSchema, versionedPushBatchSchema]);

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

export const eventRecordSchema = recordBaseSchema.extend({
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

export const relayStateSchema = z.object({
  version: z.literal(1),
  binding: bindingSchema,
  nextSequence: z.number().int().positive(),
  records: z.record(z.string(), eventRecordSchema),
}).strict();

export type EventRecord = z.infer<typeof eventRecordSchema>;

export type EventState = EventRecord["state"];

export type WatchingState = z.infer<typeof watchStateSchema>;

export type RelayState = z.infer<typeof relayStateSchema>;

export type PushBatch = z.infer<typeof pushBatchSchema>;

export type OutboxResume = z.infer<typeof outboxResumeSchema>;

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
  attachments: z.array(z.object({
    kind: z.string().min(1).max(40),
    path: z.string().min(1).max(4096),
    mime: z.string().min(1).max(120),
    name: z.string().max(500).optional(),
  }).passthrough()).max(10).optional(),
}).passthrough();

export const requestSnapshotSchema = z.object({
  messageId: idSchema,
  activeLeafId: idSchema.nullable(),
  phase: z.enum(["working", "waiting", "settled", "untracked"]),
  messages: z.array(requestMessageSchema),
}).passthrough();

type RequestMessage = z.infer<typeof requestMessageSchema>;

type OwnedImageAttachment = Readonly<{
  messageId: string;
  attachmentIndex: number;
  requestMessageId: string;
  turnId: string;
  name: string;
  mime: "image/jpeg" | "image/png";
}>;

export function ownedImageAttachments(messages: readonly RequestMessage[], requestMessageId: string, turnId: string): {
  images: OwnedImageAttachment[];
  unsupportedMedia: boolean;
} {
  const images: OwnedImageAttachment[] = [];
  let unsupportedMedia = false;
  for (const message of messages) {
    if (message.role !== "bot" || message.kind !== "text" || message.requestMessageId !== requestMessageId || message.turnId !== turnId) continue;
    for (const [attachmentIndex, attachment] of (message.attachments ?? []).entries()) {
      const isImage = attachment.kind === "image" || attachment.mime.startsWith("image/");
      const isVideo = attachment.mime.startsWith("video/");
      if (!isImage && !isVideo) continue;
      if (attachment.kind !== "image" || (attachment.mime !== "image/jpeg" && attachment.mime !== "image/png")) {
        unsupportedMedia = true;
        continue;
      }
      const name = lineImageAttachmentName({ path: attachment.path, mime: attachment.mime });
      if (!name) {
        unsupportedMedia = true;
        continue;
      }
      images.push({
        messageId: message.id,
        attachmentIndex,
        requestMessageId,
        turnId,
        name,
        mime: attachment.mime,
      });
      if (images.length > 10) unsupportedMedia = true;
    }
  }
  return { images, unsupportedMedia };
}

function textChunks(text: string): string[] {
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
  return chunks;
}

export function textBatches(text: string): PushBatch[] {
  const chunks = textChunks(text);
  const batches: PushBatch[] = [];
  for (let index = 0; index < chunks.length; index += MAX_LINE_PUSH_MESSAGES) {
    batches.push({ retryKey: randomUUID(), messages: chunks.slice(index, index + MAX_LINE_PUSH_MESSAGES), format: "table-flex-v1" });
  }
  return batches;
}

export function versionedBatches(text: string, images: readonly LineMediaUrls[], publicOrigin: string): PushBatch[] {
  const messages: Array<LineMessage | { type: "image"; originalContentUrl: string; previewImageUrl: string }> =
    (text.trim() ? textChunks(text) : []).map((chunk) => formatLineMessage(chunk));
  for (const image of images) messages.push({ type: "image", ...image });
  const batches: PushBatch[] = [];
  for (let index = 0; index < messages.length; index += MAX_LINE_PUSH_MESSAGES) {
    const payload = versionedPushPayloadSchema.parse({
      version: 1,
      publicOrigin,
      messages: messages.slice(index, index + MAX_LINE_PUSH_MESSAGES),
    });
    batches.push({ retryKey: randomUUID(), payload });
  }
  return batches;
}
