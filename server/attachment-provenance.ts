export type AttachmentCapabilityContext = Readonly<{
  botId: string;
  threadId: string;
  generation: string;
}>;

export type AttachmentRequestOwner = {
  botId: string;
  generation: string;
  messageId?: string;
  turnId: string | null;
  stopped?: boolean;
};

export type AttachmentRequestProvenance = Readonly<{
  requestMessageId: string;
  turnId: string;
}>;

export function attachmentRequestProvenance(
  capability: AttachmentCapabilityContext,
  senderBotId: string,
  threadId: string,
  currentGeneration: string | undefined,
  owner: Readonly<AttachmentRequestOwner> | undefined,
): AttachmentRequestProvenance | undefined {
  if (capability.botId !== senderBotId || capability.threadId !== threadId ||
      capability.generation !== currentGeneration || !owner || owner.botId !== capability.botId ||
      owner.generation !== capability.generation || owner.stopped === true ||
      !owner.messageId || !owner.turnId) return undefined;
  return { requestMessageId: owner.messageId, turnId: owner.turnId };
}
