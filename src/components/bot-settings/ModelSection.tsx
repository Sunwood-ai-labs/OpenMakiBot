// Model: which provider/model this bot runs on, and how hard it thinks.
// Moved verbatim from SettingsPanel.tsx (~835-881), except ModelPicker no
// longer gets `contained` — that layout renders its dropdown inline at
// `w-full` for the old 400px settings aside, where a floating popover
// wouldn't fit; this dialog is 860px wide, so the picker's normal floating
// dropdown fits fine and the label it used to lay out for `contained` is
// laid out here instead.
import { ModelPicker } from "../ModelPicker";
import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

export function ModelSection({
  bot,
  derived,
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const { patch, engine } = derived;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[15px] font-medium text-ink">Model</div>
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              Which provider and model this bot runs on
            </div>
          </div>
          <ModelPicker bot={bot} />
        </div>
      </div>

      {!!engine?.capabilities?.effortLevels?.length && (
        <div className="rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Effort</div>
          {/* Says what the app does, not what the engine ends up at:
              Codex applies a level to the whole thread and has no way to
              take one back, so "currently: engine default" was a promise
              we could not keep for a thread that had already been sent
              one. Sending nothing is true on every engine. */}
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            How hard this bot thinks{bot.modelSelection.effort ? "" : " (Default: no level is sent)"}
          </div>
          <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
            {([undefined, ...engine.capabilities.effortLevels] as const).map((level, i) => (
              <button
                key={level ?? "default"}
                aria-pressed={bot.modelSelection.effort === level}
                onClick={() => patch({ modelSelection: { ...bot.modelSelection, effort: level } })}
                className={cn(
                  "flex-1 py-1.5 text-[13px] capitalize",
                  i > 0 && "border-l border-hairline/40",
                  bot.modelSelection.effort === level
                    ? "bg-control text-ink"
                    : "text-ink-secondary hover:bg-control/60 hover:text-ink",
                )}
              >
                {/* the others capitalize cleanly; "xhigh" would read "Xhigh" */}
                {level === "xhigh" ? "X-High" : (level ?? "Default")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
