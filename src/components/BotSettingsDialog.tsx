// Per-bot settings, as a centered dialog with the same section-rail shell
// as the app SettingsModal — replaces the old right-hand SettingsPanel
// aside. Only overview/identity/soul are wired up in this commit; every
// other section is a placeholder until later commits move it over.
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import type { BotOverview } from "@/lib/bot-overview-types";
import { cn } from "@/lib/cn";
import { BOT_SECTIONS } from "./bot-settings/sections";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { OverviewSection } from "./bot-settings/OverviewSection";
import { IdentitySection } from "./bot-settings/IdentitySection";
import { SoulSection } from "./bot-settings/SoulSection";
import type { PromptPreviewData } from "./bot-settings/PromptPreview";

function sectionMatches(entry: (typeof BOT_SECTIONS)[number], query: string): boolean {
  if (!query) return true;
  return [entry.label, ...entry.keywords].some((part) => part.toLowerCase().includes(query));
}

export function BotSettingsDialog({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const section = state.botSettingsSection;
  const derived = useBotSettingsDerived(bot);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visibleSections = BOT_SECTIONS.filter((entry) => sectionMatches(entry, q));

  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [prompt, setPrompt] = useState<PromptPreviewData | null>(null);
  const [promptError, setPromptError] = useState(false);

  // A new bot starts from a clean slate rather than showing the previous
  // bot's overview for a moment.
  useEffect(() => {
    setOverview(null);
    setOverviewError(false);
    setPrompt(null);
    setPromptError(false);
  }, [bot.id]);

  // Loads on open, and again whenever bot.id, state.routines, state.webhooks,
  // or the bot record change — those are exactly the facts the server-built
  // overview and system-prompt preview depend on. Debounced to one request
  // per 500ms so a burst of edits (typing in a field, several routine
  // changes) coalesces into a single refetch instead of one per keystroke.
  // Each fetch is wrapped so one failing leaves only its own block reading
  // "couldn't load" rather than throwing and breaking the rest of the dialog.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api(`/api/bots/${bot.id}/overview`)
        .then((data: BotOverview) => {
          setOverview(data);
          setOverviewError(false);
        })
        .catch(() => setOverviewError(true));
      void api(`/api/bots/${bot.id}/system-prompt`)
        .then((data: PromptPreviewData) => {
          setPrompt(data);
          setPromptError(false);
        })
        .catch(() => setPromptError(true));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [bot.id, bot, state.routines, state.webhooks]);

  useEffect(() => {
    const visible = BOT_SECTIONS.filter((entry) => sectionMatches(entry, q));
    if (visible.some((entry) => entry.id === section)) return;
    const first = visible[0];
    if (first) dispatch({ type: "toggleSettings", open: true, section: first.id });
  }, [dispatch, q, section]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && dispatch({ type: "toggleSettings", open: false })}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-settings-title"
        tabIndex={-1}
        className="flex h-[560px] w-full max-w-[860px] overflow-hidden rounded-2xl border border-hairline/50 bg-panel shadow-2xl outline-none"
      >
        {/* section nav */}
        <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r border-hairline/40 p-3">
          <div id="bot-settings-title" className="truncate px-2 pb-2 pt-1 text-[15px] font-semibold text-ink">
            {bot.name}
          </div>
          <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-control/70 px-2.5 py-1.5">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                if (query) setQuery("");
                else dispatch({ type: "toggleSettings", open: false });
              }}
              placeholder="Search"
              aria-label="Search settings"
              className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          {visibleSections.length === 0 && (
            <div className="px-2.5 py-4 text-[12.5px] leading-relaxed text-ink-secondary">
              Nothing matches “{query.trim()}”
            </div>
          )}
          {visibleSections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => dispatch({ type: "toggleSettings", open: true, section: id })}
              aria-current={section === id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px]",
                section === id ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/50 hover:text-ink",
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-[15px] font-semibold text-ink">
              {BOT_SECTIONS.find((s) => s.id === section)?.label}
            </span>
            <button
              onClick={() => dispatch({ type: "toggleSettings", open: false })}
              aria-label="Close settings"
              className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
            {section === "overview" &&
              (overviewError ? (
                <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">Couldn’t load the overview.</div>
              ) : (
                <OverviewSection
                  overview={overview}
                  prompt={promptError ? null : prompt}
                  onOpen={(target) => dispatch({ type: "toggleSettings", open: true, section: target })}
                />
              ))}

            {section === "identity" && (
              <IdentitySection
                bot={bot}
                patch={derived.patch}
                activeState={derived.activeState}
                mascotMotion={derived.mascotMotion}
              />
            )}

            {section === "soul" && <SoulSection bot={bot} patch={derived.patch} />}

            {section !== "overview" && section !== "identity" && section !== "soul" && (
              <div className="text-[13px] text-ink-secondary">Moving in the next commit.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
