import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { profileRevision } from "./profile-revision.ts";
import { flushProfileHistory, readHistory } from "./profile-versions.ts";
import {
  ProfileRequestService,
  type OptionCardLike,
  type ProfileRequestStore,
} from "./profile-requests.ts";
import type { BotRecord } from "./store.ts";

interface StoredMessage {
  id: string;
  card?: OptionCardLike;
}

class MemoryStore implements ProfileRequestStore {
  readonly bots = new Map<string, BotRecord>();
  readonly threads = new Map<string, StoredMessage[]>();
  readonly setSoulCalls: Array<[string, string]> = [];
  private sequence = 0;

  bot(id: string): BotRecord | undefined {
    return this.bots.get(id);
  }

  messagesFor(threadId: string): StoredMessage[] {
    return this.threads.get(threadId) ?? [];
  }

  appendMessage(
    threadId: string,
    message: { role: "bot"; kind: "options"; card: OptionCardLike; from?: { botId: string; name: string; color: string } },
  ): StoredMessage {
    const stored: StoredMessage = { id: `message-${++this.sequence}`, card: message.card };
    const messages = this.threads.get(threadId) ?? [];
    messages.push(stored);
    this.threads.set(threadId, messages);
    return stored;
  }

  patchMessage(
    threadId: string,
    messageId: string,
    patch: { card: OptionCardLike },
  ): StoredMessage | null {
    const message = this.messagesFor(threadId).find((candidate) => candidate.id === messageId);
    if (!message) return null;
    message.card = patch.card;
    return message;
  }

  patchBot(id: string, patch: Partial<Pick<BotRecord, "name" | "title" | "description">>): BotRecord | null {
    const bot = this.bots.get(id);
    if (!bot) return null;
    Object.assign(bot, patch);
    return bot;
  }

  setSoul(id: string, soul: string): BotRecord | null {
    this.setSoulCalls.push([id, soul]);
    const bot = this.bots.get(id);
    if (!bot) return null;
    bot.soul = soul;
    return bot;
  }
}

function harness(options: { name: string; chiefOfStaff?: boolean }) {
  const store = new MemoryStore();
  const service = new ProfileRequestService({ store });

  function addBot(overrides: { name: string }): BotRecord {
    const record = {
      id: randomUUID(),
      threadId: randomUUID(),
      name: overrides.name,
      title: "",
      description: "",
      soul: "",
      notifications: true,
      color: "blue",
      unread: false,
      modelSelection: "default",
      resumeCursors: {},
    } as unknown as BotRecord;
    store.bots.set(record.id, record);
    return record;
  }

  const bot = addBot({ name: options.name });
  return { service, store, bot, addBot };
}

describe("ProfileRequestService", () => {
  it("validates through the profile boundary, pins a revision, and appends a durable card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const result = service.propose({
      botId: bot.id,
      threadId: bot.threadId,
      changes: { name: "Kiwi", title: "Tracker", soul: "File bugs.\nNever noise. sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      reason: "You asked me to track Discord.",
    });
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.tool).toBe("update_profile");
    expect(card.options).toEqual(["Confirm", "Cancel"]);
    expect(card.profileRequest).toMatchObject({
      version: 1,
      botId: bot.id,
      threadId: bot.threadId,
      targetBotId: bot.id,
      targetName: "Scout",
      changes: { name: "Kiwi", title: "Tracker" },
      before: { name: "Scout", title: "", soul: "" },
    });
    expect(card.profileRequest!.changes.soul).not.toContain("sk-ant-api03-AAAA");
    expect(card.profileRequest!.expectedRevision).toBe(profileRevision(bot));
    expect(result.title).toBe("Set up Scout?");
    expect(card.subtitle).toContain('Name: "Scout" → "Kiwi"');
    expect(card.subtitle).toContain("+File bugs.");
    expect(card.subtitle).toContain("Changes what Scout is told on every turn. Nothing runs.");
  });

  it("refuses unsupported fields, over-cap values, a missing reason, and empty changes with the boundary's copy", () => {
    const { service, bot } = harness({ name: "Scout" });
    const attempt = (changes: unknown, reason: unknown = "r") =>
      () => service.propose({ botId: bot.id, threadId: bot.threadId, changes, reason });
    expect(attempt({ notifications: false })).toThrow("unsupported profile field: notifications");
    expect(attempt({ soul: "x".repeat(24_001) })).toThrow("standing instructions must be at most 24000 bytes");
    expect(attempt({ name: "Kiwi" }, "")).toThrow("reason is required");
    expect(attempt({})).toThrow("Choose at least one of name, title, description, soul");
    expect(attempt({ name: "Scout" })).toThrow("Nothing would change");
  });

  it("applies only on confirm, through patchBot and setSoul, records history, and settles the card", async () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi", soul: "Be brief." }, reason: "r" });
    expect(store.bot(bot.id)!.name).toBe("Scout");
    const denied = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: "nope", behavior: "allow" });
    expect(denied).toEqual({ claimed: false, state: "not_found" });
    const applied = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" });
    expect(applied).toEqual({ claimed: true, state: "applied", targetBotId: bot.id, fields: ["name", "soul"] });
    expect(store.bot(bot.id)).toMatchObject({ name: "Kiwi", soul: "Be brief." });
    expect(store.setSoulCalls).toEqual([[bot.id, "Be brief."]]);
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.answered).toBe("allow");
    expect(card.profileRequest!.appliedAt).toBeGreaterThan(0);
    await flushProfileHistory(bot.id);
    expect(readHistory(bot.id).map((r) => [r.field, r.actor, r.via])).toEqual([
      ["soul", "bot", `card:${store.messagesFor(bot.threadId).at(-1)!.id}`],
      ["name", "bot", `card:${store.messagesFor(bot.threadId).at(-1)!.id}`],
    ]);
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toEqual({ claimed: true, state: "already_settled", behavior: "allow" });
  });

  it("denies without changing anything, and fails closed when the profile moved after the card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const a = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: a.requestId, behavior: "deny" }))
      .toEqual({ claimed: true, state: "denied" });
    expect(store.bot(bot.id)!.title).toBe("");
    const b = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    store.patchBot(bot.id, { description: "changed elsewhere" });
    const stale = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: b.requestId, behavior: "allow" });
    expect(stale).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect((stale as { error: string }).error).toBe("This bot's profile changed after this card was prepared. Ask the bot to review it and propose again.");
    expect(store.messagesFor(bot.threadId).at(-1)!.card!.held).toContain("changed after this card");
    expect(store.bot(bot.id)!.title).toBe("");
  });

  it("pins ownership to the proposing conversation and rejects other behaviors", () => {
    const { service, bot } = harness({ name: "Scout" });
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    expect(service.resolve({ botId: "other", threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 403 });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "answer" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 400 });
  });

  it("lets a validated target be another bot, re-checks it at confirm, and applies to the target", () => {
    const { service, store, bot, addBot } = harness({ name: "Chief", chiefOfStaff: true });
    const peer = addBot({ name: "Peer" });
    let refuse: string | null = null;
    service.validateTarget = () => refuse;
    const { requestId, title } = service.propose({ botId: bot.id, threadId: bot.threadId, targetBotId: peer.id, changes: { title: "Analyst" }, reason: "r" });
    expect(title).toBe("Update @Peer's profile?");
    refuse = "@Peer is no longer in this section";
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 404 });
    refuse = null;
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ state: "applied", targetBotId: peer.id });
    expect(store.bot(peer.id)!.title).toBe("Analyst");
    expect(store.bot(bot.id)!.title).toBe("");
  });
});
