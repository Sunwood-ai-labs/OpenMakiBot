import type { ComponentProps } from "react";
import { Paperclip } from "lucide-react";
import { t } from "@/lib/i18n";
import { ApprovalModeSelector } from "./ApprovalModeSelector";
import { ComposerPlusMenu, GoalToggle } from "./ComposerPlusMenu";
import { PlaceChip, usePlaceMenuItem } from "./PlaceChip";

export type ComposerToolsProps = Pick<
  ComponentProps<typeof ComposerPlusMenu>,
  "onAttach" | "goal" | "approval" | "callBotId"
> & {
  layout: "phone" | "desktop";
  advanced: boolean;
  approvalChoice?: ComponentProps<typeof ApprovalModeSelector>;
  place?: Parameters<typeof usePlaceMenuItem>[0];
};

type PhonePlusProps = Pick<ComposerToolsProps, "onAttach" | "goal" | "approval" | "callBotId">;

function PhonePlusWithPlace({ place, ...rest }: PhonePlusProps & { place: Parameters<typeof usePlaceMenuItem>[0] }) {
  const item = usePlaceMenuItem(place);
  return <ComposerPlusMenu {...rest} extraItems={[item]} circle />;
}

function PhonePlus({ place, ...rest }: PhonePlusProps & { place?: Parameters<typeof usePlaceMenuItem>[0] }) {
  return place ? <PhonePlusWithPlace place={place} {...rest} /> : <ComposerPlusMenu {...rest} circle />;
}

export function ComposerTools({ layout, advanced, onAttach, goal, approval, callBotId, approvalChoice, place }: ComposerToolsProps) {
  if (layout === "phone") {
    return (
      <div className="flex shrink-0 items-center">
        <PhonePlus onAttach={onAttach} goal={goal} approval={approval} callBotId={callBotId} place={place} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {!advanced && <ComposerPlusMenu onAttach={onAttach} goal={goal} approval={approval} callBotId={callBotId} />}
      {advanced && <button
        type="button"
        onClick={onAttach}
        aria-label={t("composer.attach")}
        title={t("composer.attach")}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink"
      >
        <Paperclip size={17} />
      </button>}
      {goal && (advanced || goal.on) && <GoalToggle on={goal.on} onToggle={goal.onToggle} />}
      {advanced && approvalChoice && <ApprovalModeSelector {...approvalChoice} />}
      {place && advanced && <PlaceChip {...place} live={Boolean(place.bot.busy)} />}
    </div>
  );
}
