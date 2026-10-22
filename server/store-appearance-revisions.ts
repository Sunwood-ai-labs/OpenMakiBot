import type { BotRecord } from "./store.ts";

const APPEARANCE_FIELDS = [
  "avatarUrl",
  "avatarCrop",
  "mascotBody",
  "mascotProfile",
  "color",
  "mascotExpression",
] as const satisfies readonly (keyof BotRecord)[];

export class BotAppearanceRevisionTracker {
  private readonly revisions = new WeakMap<BotRecord, number>();

  get(bot: BotRecord): number {
    return this.revisions.get(bot) ?? 0;
  }

  record(bot: BotRecord): void {
    this.revisions.set(bot, this.get(bot) + 1);
  }

  recordChoice(bot: BotRecord, patch: Partial<BotRecord>): void {
    if (APPEARANCE_FIELDS.some((field) => Object.hasOwn(patch, field))) this.record(bot);
  }
}
