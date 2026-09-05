// The revision token a profile card pins to. It covers exactly the
// fields a bot may propose (PROFILE_REQUEST_FIELDS), so a confirmation fails closed if any of them
// moved between the card and the click — the profile analogue of a
// routine's expectedUpdatedAt (bots have no updatedAt of their own).
import { createHash } from "node:crypto";

import type { ProfileRequestChanges } from "../shared/profile-request.ts";

export function profileSnapshot(
  bot: { name: string; title: string; description: string; soul?: string; cwd?: string },
): Required<ProfileRequestChanges> {
  return { name: bot.name, title: bot.title, description: bot.description, soul: bot.soul ?? "", cwd: bot.cwd ?? "" };
}

export function profileRevision(
  bot: { name: string; title: string; description: string; soul?: string; cwd?: string },
): string {
  return createHash("sha256").update(JSON.stringify(profileSnapshot(bot)), "utf8").digest("hex");
}
