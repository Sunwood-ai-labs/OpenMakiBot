// Identity: avatar, name, title, and the short blurb every roster and the
// phone show. Long standing instructions belong in Soul (SoulSection) —
// this section only keeps the "View full" dialog for the blurb itself.
// Moved out of SettingsPanel.tsx (its header, avatar card, Name, Title,
// and Instructions block) with only the label and helper text changed.
import { useState } from "react";
import { BookOpen } from "lucide-react";

import type { Bot } from "@/state/store";
import type { MausMotion, MausState } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { BotProfileAvatarCard } from "../BotProfileAvatarCard";
import { BotInstructionsDialog } from "../BotInstructionsDialog";
import { Field, inputCls } from "./field";
import type { BotPatch } from "./useBotSettingsDerived";

export function IdentitySection({
  bot,
  patch,
  activeState,
  mascotMotion,
}: {
  bot: Bot;
  patch: (patch: BotPatch) => void;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
}) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <BotProfileAvatarCard bot={bot} activeState={activeState} mascotMotion={mascotMotion} onPatch={patch} />

      <Field label="Name">
        <input
          className={inputCls}
          maxLength={BOT_PROFILE_LIMITS.name}
          value={bot.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>
      <Field label="Title">
        <input
          className={inputCls}
          maxLength={BOT_PROFILE_LIMITS.title}
          placeholder="Describe what your agent does"
          value={bot.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>
      <div className="block">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor={`bot-instructions-${bot.id}`} className="text-[13px] text-ink-secondary">
            Blurb
          </label>
          <button
            type="button"
            onClick={() => setInstructionsOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-accent-text hover:bg-accent/10"
          >
            <BookOpen size={12} /> View full
          </button>
        </div>
        <textarea
          id={`bot-instructions-${bot.id}`}
          className={cn(inputCls, "min-h-[176px] resize-y leading-relaxed")}
          maxLength={BOT_PROFILE_LIMITS.description}
          placeholder="Describe this bot’s role, priorities, working style, and boundaries"
          aria-label="Bot instructions"
          value={bot.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
        <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] text-ink-secondary">
          <span>One line shown in rosters and on the phone. Long instructions belong in Soul.</span>
          <span className="shrink-0 tabular-nums">
            {bot.description.length.toLocaleString()} / {BOT_PROFILE_LIMITS.description.toLocaleString()}
          </span>
        </div>
      </div>

      {instructionsOpen && <BotInstructionsDialog bot={bot} onClose={() => setInstructionsOpen(false)} />}
    </div>
  );
}
