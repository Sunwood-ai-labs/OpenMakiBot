import type { CSSProperties, Dispatch, JSX } from "react";
import { Monitor, Square } from "lucide-react";

import { rememberComputerPanelOpen } from "@/lib/computer-panel-focus";
import { COMPACT_BUBBLE } from "@/lib/compact-chip";
import { cn } from "@/lib/cn";
import { type EffectivePlace } from "@/lib/place";
import { t } from "@/lib/i18n";
import {
  openThread,
  type Action,
  type AppState,
  type Bot,
  type Message,
} from "@/state/store";
import { EngineLimitNotice } from "./LimitResetContinue";
import { ThreadContextWarning } from "./ContextWarning";
import { ChatHeaderMenu, ChatMoreMenu } from "./ChatMoreMenu";
import { LiveCallChip } from "./LiveCallPill";
import { ModelPicker } from "./ModelPicker";

type ChatHeaderControlsProps = {
  bot: Bot;
  messages: Message[];
  state: AppState;
  dispatch: Dispatch<Action>;
  advanced: boolean;
  phone: boolean;
  remoteClient: boolean;
  busy: boolean;
  place: EffectivePlace;
  showThreads: boolean;
  controlsShiftStyle: CSSProperties | undefined;
};

export function ChatHeaderControls({
  bot,
  messages,
  state,
  dispatch,
  advanced,
  phone,
  remoteClient,
  busy,
  place,
  showThreads,
  controlsShiftStyle,
}: ChatHeaderControlsProps): JSX.Element {
  const phoneMenu = phone && !remoteClient;
  return (
    <div
      data-chathead-controls
      className={cn("flex shrink-0 items-center gap-2", !phone && "@max-[30rem]/chathead:ml-auto @max-[30rem]/chathead:flex-wrap @max-[30rem]/chathead:justify-end @min-[30rem]/chathead:col-start-3 @min-[30rem]/chathead:justify-self-end")}
      style={controlsShiftStyle}
    >
      {(bot.busy || bot.waitingForTeammates) && (
        <button
          onClick={() => dispatch({ type: "interrupt", botId: bot.id, threadId: bot.threadId })}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink",
            COMPACT_BUBBLE,
          )}
          title={t("chat.stopTurn")}
        >
          <Square size={12} className="fill-current" />
          <span className="@max-4xl/chathead:hidden">{t("chat.stop")}</span>
        </button>
      )}
      <ThreadContextWarning bot={bot} messages={messages} />
      <EngineLimitNotice engine={bot.modelSelection?.instanceId} />
      {advanced && !remoteClient && !phone && <ModelPicker key={bot.threadId} bot={bot} threadId={bot.threadId} />}
      <LiveCallChip currentBotId={bot.id} onOpen={(botId, threadId) => openThread(dispatch, { botId, threadId }, state, showThreads)} />
      {(advanced || remoteClient) && !phoneMenu && <button
        data-tour="computer"
        onClick={(event) => { if (!state.computerOpen) rememberComputerPanelOpen({ botId: bot.id, opener: event.currentTarget, tabs: event.detail === 0 }); dispatch({ type: "toggleComputer" }); }}
        className={cn(
          "relative rounded-md p-1.5 hover:bg-raised",
          state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
        )}
        title={t("chat.computer")} aria-label={busy && place === "browser" ? t("chat.computer") + ", " + t("place.live") : t("chat.computer")}
      >
        <Monitor size={18} />{busy && place === "browser" && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-success" data-testid="computer-button-live" />}
      </button>}
      {phoneMenu ? <ChatMoreMenu bot={bot} phoneHeader /> : (advanced || remoteClient) && <ChatHeaderMenu key={"menu:" + bot.threadId} bot={bot} />}
    </div>
  );
}
