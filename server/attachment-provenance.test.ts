import { describe, expect, it } from "vitest";
import { attachmentRequestProvenance, type AttachmentCapabilityContext, type AttachmentRequestOwner } from "./attachment-provenance.ts";

const capability: AttachmentCapabilityContext = { botId: "bot-a", threadId: "thread-a", generation: "generation-a" };
const owner: AttachmentRequestOwner = {
  botId: "bot-a", generation: "generation-a", messageId: "request-a", turnId: "turn-a",
};
const provenance = (
  currentCapability: AttachmentCapabilityContext = capability,
  senderBotId = "bot-a",
  threadId = "thread-a",
  currentGeneration: string | undefined = "generation-a",
  currentOwner: AttachmentRequestOwner | undefined | null = owner,
) => attachmentRequestProvenance(currentCapability, senderBotId, threadId, currentGeneration, currentOwner ?? undefined);

describe("attachment request provenance", () => {
  it("returns the current request and turn only for the matching owner", () => {
    expect(provenance()).toEqual({ requestMessageId: "request-a", turnId: "turn-a" });
  });

  it("does not transfer ownership across bots in a shared generation", () => {
    expect(provenance({ ...capability, botId: "bot-b" }, "bot-b", "thread-a", "generation-a", owner)).toBeUndefined();
  });

  it("rejects mismatched sender, thread, generation, stopped, and orphan contexts", () => {
    expect(provenance(capability, "bot-b")).toBeUndefined();
    expect(provenance(capability, "bot-a", "thread-b")).toBeUndefined();
    expect(provenance(capability, "bot-a", "thread-a", "generation-b")).toBeUndefined();
    expect(provenance(capability, "bot-a", "thread-a", "generation-a", { ...owner, generation: "generation-b" })).toBeUndefined();
    expect(provenance(capability, "bot-a", "thread-a", "generation-a", { ...owner, stopped: true })).toBeUndefined();
    expect(provenance(capability, "bot-a", "thread-a", "generation-a", null)).toBeUndefined();
    expect(provenance(capability, "bot-a", "thread-a", "generation-a", { ...owner, messageId: undefined })).toBeUndefined();
    expect(provenance(capability, "bot-a", "thread-a", "generation-a", { ...owner, turnId: null })).toBeUndefined();
  });
});
