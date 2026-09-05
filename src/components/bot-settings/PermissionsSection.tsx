// Permissions: how autonomously this bot acts — Auto mode, review-routine
// approvals, whether it asks before contacting other bots, and whether it
// holds the section's Chief of Staff role. Moved verbatim from
// SettingsPanel.tsx (Chief of Staff ~720-755, Ask-before-contacting
// ~757-776, Auto mode ~968-989, Review routine approvals ~991-1024).
//
// The Auto-mode branch of LocalComputerAutoWarning (warning when turning
// Auto mode on while bot.computer === "local") moves here with its
// trigger; the Works-on-picker branch (turning computer to "local" while
// Auto mode is already on) stays with AccessSection, next to that picker.
// Each section keeps its own local `localAutoWarning` state — only one
// section is ever visible at a time, so there's no risk of two warnings
// fighting over one flag the way SettingsPanel's single shared state did.
import { useState } from "react";
import { Crown } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { Switch } from "../SettingsPrimitives";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

export function PermissionsSection({
  bot,
  derived,
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const { patch, canCoordinate, canAutoReview, sectionName, currentChief } = derived;
  const [localAutoWarning, setLocalAutoWarning] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "rounded-xl border p-4",
          bot.chiefOfStaff ? "border-accent/40 bg-accent/10" : "border-hairline/40 bg-card",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              bot.chiefOfStaff ? "bg-accent text-white" : "bg-control text-ink-secondary",
            )}
          >
            <Crown size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-ink">Chief of Staff</div>
            <div className="text-[11.5px] text-ink-secondary">One for {sectionName}</div>
          </div>
          <Switch
            checked={Boolean(bot.chiefOfStaff)}
            aria-label="Chief of Staff"
            disabled={!bot.chiefOfStaff && !canCoordinate}
            onClick={() => patch({ chiefOfStaff: !bot.chiefOfStaff })}
            title={!bot.chiefOfStaff && !canCoordinate ? "This engine cannot contact other bots" : undefined}
            className="disabled:cursor-not-allowed"
          />
        </div>
        <div className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          {bot.chiefOfStaff && !canCoordinate
            ? "This bot still holds the role, but its current engine cannot contact teammates. Choose a Claude or ACP engine to restore coordination."
            : bot.chiefOfStaff
              ? `This is the primary contact for ${sectionName}. It can create and coordinate specialists in this section, then combine their work into one answer.`
              : !canCoordinate
                ? "Choose a Claude or ACP engine to let this bot coordinate teammates."
                : currentChief
                  ? `Make this bot the ${sectionName} Chief and hand the role over from ${currentChief.name}.`
                  : `Make this bot the primary contact for the ${sectionName} section.`}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
        <div>
          <div className="text-[15px] font-medium text-ink">Ask me before contacting other bots</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {bot.approvePeerComms
              ? "This bot will stop and ask before it reaches out to another bot."
              : "Let this bot talk to teammates on its own, without a confirmation step."}
          </div>
        </div>
        <Switch
          checked={Boolean(bot.approvePeerComms)}
          aria-label="Ask me before contacting other bots"
          disabled={!bot.approvePeerComms && !canCoordinate}
          onClick={() => patch({ approvePeerComms: !bot.approvePeerComms })}
          title={!bot.approvePeerComms && !canCoordinate ? "This engine cannot contact other bots" : undefined}
          className="disabled:cursor-not-allowed"
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
        <div>
          <div className="text-[15px] font-medium text-ink">Auto mode</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {bot.computer === "local"
              ? bot.autoApprove
                ? "Keeps going on this computer — you'll still be asked about anything destructive, and about questions it asks you."
                : "Approve each action on this computer yourself. Turn on to let this bot keep working without stopping to ask."
              : bot.autoApprove
                ? "Keeps going on its own — you'll still be asked about anything destructive, and about questions it asks you."
                : "Approve each action yourself. Turn on to let this bot keep working without stopping to ask."}
          </div>
        </div>
        <Switch
          checked={Boolean(bot.autoApprove)}
          aria-label="Auto mode"
          onClick={() => {
            if (!bot.autoApprove && bot.computer === "local") setLocalAutoWarning(true);
            else patch({ autoApprove: !bot.autoApprove });
          }}
        />
      </div>

      <div className="rounded-xl bg-card p-4">
        <div className="text-[15px] font-medium text-ink">Review routine approvals</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">
          {canAutoReview
            ? "The same engine reviews ordinary approval cards. Existing safety rules, unattended turns, local-computer access, and questions still wait for you."
            : "This engine cannot run an isolated review safely, so approval cards continue to wait for you."}
        </div>
        <div className="mt-3 flex gap-1 rounded-lg bg-inset p-0.5">
          {(
            [
              ["off", "Off", "Every undecided approval waits for you."],
              ["shadow", "Watch", "Record the review without answering the card."],
              ["enforce", "On", "Answer only reviews that return a strict approval."],
            ] as const
          ).map(([value, label, hint]) => {
            const current = bot.autoReview === "shadow" || bot.autoReview === "enforce" ? bot.autoReview : "off";
            const disabled = value !== "off" && !canAutoReview;
            return (
              <button
                key={value}
                title={disabled ? "Not supported by this engine" : hint}
                disabled={disabled}
                onClick={() => patch({ autoReview: value })}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40",
                  current === value ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <LocalComputerAutoWarning
        open={localAutoWarning}
        onCancel={() => setLocalAutoWarning(false)}
        onConfirm={() => {
          patch({ autoApprove: true, acknowledgeLocalAuto: true });
          setLocalAutoWarning(false);
        }}
      />
    </div>
  );
}
