// The SOUL.md editor: the bot's standing instructions, byte-counted
// against the server cap, with a banner when the file on disk was edited
// outside the app. Edits go to the record through the normal bot patch;
// the server writes the mirror. A draft that is over the cap stays local
// and is never sent, so the counter is the only thing that turns red.
import { useEffect, useState } from "react";

import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { cn } from "@/lib/cn";
import { firstSentence, utf8Bytes } from "@/lib/soul";
import { api, type Bot } from "@/state/store";

type SoulRead = { soul: string; bytes: number; limit: number; file: string; drift: boolean; fileText?: string };

// Same field styling as SettingsPanel's own inputs.
const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none focus:border-hairline";

export function SoulField({
  bot,
  onPatch,
}: {
  bot: Bot;
  onPatch: (patch: { soul?: string; description?: string }) => void;
}) {
  const limit = BOT_PROFILE_LIMITS.soul;
  const [draft, setDraft] = useState(bot.soul ?? "");
  const [info, setInfo] = useState<SoulRead | null>(null);

  // A new bot, or a server-side change (drift resolved, another client),
  // replaces the draft. While the user types, the draft leads.
  useEffect(() => {
    setDraft(bot.soul ?? "");
  }, [bot.id, bot.soul]);

  const refresh = () => {
    void api(`/api/bots/${bot.id}/soul`)
      .then((read: SoulRead) => setInfo(read))
      .catch(() => setInfo(null));
  };
  useEffect(refresh, [bot.id, bot.soulDrift, bot.soul]);

  const bytes = utf8Bytes(draft);
  const over = bytes > limit;
  const change = (value: string) => {
    setDraft(value);
    if (utf8Bytes(value) <= limit) onPatch({ soul: value });
  };
  const resolve = (action: "apply-file" | "discard-file") => {
    void api(`/api/bots/${bot.id}/soul/${action}`, { method: "POST" })
      .then(refresh)
      .catch(() => {});
  };
  const canMigrate = bot.description.length > 400 && !(bot.soul ?? "").trim();

  return (
    <div className="block">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={`bot-soul-${bot.id}`} className="text-[13px] text-ink-secondary">
          Standing instructions (SOUL.md)
        </label>
        {canMigrate && (
          <button
            type="button"
            onClick={() => onPatch({ soul: bot.description, description: firstSentence(bot.description) })}
            className="rounded-md px-1.5 py-1 text-[11.5px] font-medium text-accent-text hover:bg-accent/10"
          >
            Move instructions into SOUL.md
          </button>
        )}
      </div>
      {info?.drift && (
        <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-ink">
          <div className="font-medium">SOUL.md on disk was edited outside the app.</div>
          <div className="mt-1 text-ink-secondary">
            The bot keeps using the saved version until you choose. File: <span className="break-all">{info.file}</span>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-control p-2 text-[11.5px]">{info.fileText}</pre>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => resolve("apply-file")} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110">
              Use the file
            </button>
            <button type="button" onClick={() => resolve("discard-file")} className="rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover">
              Keep the saved version
            </button>
          </div>
        </div>
      )}
      <textarea
        id={`bot-soul-${bot.id}`}
        className={cn(inputCls, "min-h-[220px] resize-y font-mono leading-relaxed", over && "ring-2 ring-red-500/60")}
        placeholder="Who this bot is and the rules it never breaks. Keep it short; put step-by-step procedure into a skill."
        aria-label="Standing instructions"
        aria-invalid={over || undefined}
        value={draft}
        onChange={(e) => change(e.target.value)}
      />
      <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] text-ink-secondary">
        <span>
          In this bot’s context on every turn.{info ? <> Mirrored to <span className="break-all">{info.file}</span>.</> : null}
        </span>
        <span className={cn("shrink-0 tabular-nums", over && "font-medium text-red-500")}>
          {bytes.toLocaleString()} / {limit.toLocaleString()} bytes{over ? " — not saved" : ""}
        </span>
      </div>
    </div>
  );
}
