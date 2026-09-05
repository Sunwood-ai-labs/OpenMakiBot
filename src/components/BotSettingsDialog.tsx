// Per-bot settings, as a centered dialog with the same section-rail shell
// as the app SettingsModal — replaces the old right-hand SettingsPanel
// aside. Every section now lives under bot-settings/; this dialog owns
// only the fetches (overview, system-prompt, history) and the section
// switch.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import type { BotOverview } from "@/lib/bot-overview-types";
import { cn } from "@/lib/cn";
import { BOT_SECTIONS } from "./bot-settings/sections";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { OverviewSection } from "./bot-settings/OverviewSection";
import { IdentitySection } from "./bot-settings/IdentitySection";
import { SoulSection } from "./bot-settings/SoulSection";
import { SkillsSection } from "./bot-settings/SkillsSection";
import { MemorySection } from "./bot-settings/MemorySection";
import { RoutinesSection } from "./bot-settings/RoutinesSection";
import { AccessSection } from "./bot-settings/AccessSection";
import { ModelSection } from "./bot-settings/ModelSection";
import { PermissionsSection } from "./bot-settings/PermissionsSection";
import { VoiceSection } from "./bot-settings/VoiceSection";
import { HistorySection, type HistoryRow } from "./bot-settings/HistorySection";
import { UsageSection } from "./bot-settings/UsageSection";
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
  const [historyRows, setHistoryRows] = useState<HistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState(false);

  // A new bot starts from a clean slate rather than showing the previous
  // bot's overview for a moment. Also marks the next overview/system-prompt
  // fetch below as a first load for this bot.id, so it fires immediately
  // rather than waiting out the debounce.
  const firstLoadRef = useRef(true);
  useEffect(() => {
    setOverview(null);
    setOverviewError(false);
    setPrompt(null);
    setPromptError(false);
    setHistoryRows(null);
    setHistoryError(false);
    firstLoadRef.current = true;
  }, [bot.id]);

  // The bot-record fields the server-built overview and system-prompt
  // preview actually read (OverviewFacts.bot plus the prompt's persona
  // inputs). Keyed as one string so a streamed message, an unread flag, or
  // a typing indicator — which all replace the bot object — never restarts
  // the debounce below; while a bot is answering, the whole object changes
  // many times a second and an effect keyed on it would never fire.
  const factsSignature = useMemo(
    () =>
      JSON.stringify([
        bot.name,
        bot.title,
        bot.description,
        bot.soul,
        bot.computer,
        bot.cloudBackend,
        bot.cwd,
        bot.autoApprove,
        bot.approvePeerComms,
        bot.peers,
        bot.section,
        bot.composio,
        bot.browser,
        bot.chiefOfStaff,
        bot.modelSelection,
      ]),
    [
      bot.name,
      bot.title,
      bot.description,
      bot.soul,
      bot.computer,
      bot.cloudBackend,
      bot.cwd,
      bot.autoApprove,
      bot.approvePeerComms,
      bot.peers,
      bot.section,
      bot.composio,
      bot.browser,
      bot.chiefOfStaff,
      bot.modelSelection,
    ],
  );

  // Loads on open, and again whenever bot.id, state.routines, state.webhooks,
  // or one of the bot fields above changes — those are exactly the facts the
  // server-built overview and system-prompt preview depend on. The very first load for a
  // given bot.id (dialog just opened, or switched bots) fires immediately —
  // there is nothing on screen yet to coalesce with, so waiting out a 500ms
  // debounce would only add a visible delay. Every later run — a dependency
  // changed while the dialog is already showing data — is still debounced to
  // one request per 500ms, so a burst of edits (typing in a field, several
  // routine changes) coalesces into a single refetch instead of one per
  // keystroke. Each fetch is wrapped so one failing leaves only its own
  // block reading "couldn't load" rather than throwing and breaking the
  // rest of the dialog.
  useEffect(() => {
    // Guards every setState below the same way AccessSection's connected-apps
    // preload does: a quick open/close (or a fast bot switch) can unmount
    // this dialog before either fetch settles, and without this flag the
    // resolved promise would still call setOverview/setPrompt/setError on a
    // component that's already gone.
    let cancelled = false;
    const fetchOverviewAndPrompt = () => {
      void api(`/api/bots/${bot.id}/overview`)
        .then((data: BotOverview) => {
          if (cancelled) return;
          setOverview(data);
          setOverviewError(false);
        })
        .catch(() => {
          if (!cancelled) setOverviewError(true);
        });
      void api(`/api/bots/${bot.id}/system-prompt`)
        .then((data: PromptPreviewData) => {
          if (cancelled) return;
          setPrompt(data);
          setPromptError(false);
        })
        .catch(() => {
          if (!cancelled) setPromptError(true);
        });
    };

    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      fetchOverviewAndPrompt();
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(fetchOverviewAndPrompt, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bot.id, factsSignature, state.routines, state.webhooks]);

  // History is fetched only once the section is actually opened — every
  // other section's data loads eagerly, but reading a bot's full change log
  // is the one facts a visit to Settings almost never needs, and the fetch
  // reads a per-bot NDJSON file (readHistory) rather than in-memory state.
  const loadHistory = useCallback(() => {
    setHistoryError(false);
    return api(`/api/bots/${bot.id}/history?limit=100`)
      .then((data: { rows: HistoryRow[] }) => setHistoryRows(data.rows))
      .catch(() => setHistoryError(true));
  }, [bot.id]);

  useEffect(() => {
    if (section !== "history") return;
    void loadHistory();
  }, [section, loadHistory]);

  // A rollback failure (the row's soul text no longer round-trips the
  // server's validation, say) still reloads history so the list matches
  // the server's actual state, but also surfaces the server's message
  // through the app's error toast — mirrors SoulField's Apply/Discard.
  const rollbackHistory = (at: number) => {
    void api(`/api/bots/${bot.id}/history/rollback`, { method: "POST", body: JSON.stringify({ at }) }).then(
      () => loadHistory(),
      (e: unknown) => {
        dispatch({ type: "error", message: e instanceof Error ? e.message : "Couldn't undo that change." });
        return loadHistory();
      },
    );
  };

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
      // A dialog opened from inside this one (the routine editor, a skill
      // review, the model picker's popover, a computer warning) owns Escape
      // and Tab while it is up: Escape closes only that layer, and the focus
      // trap below must not pull focus back out of it.
      if (dialog?.querySelector('[role="dialog"]')) return;
      // BotInstructionsDialog portals to document.body, so it is not in this
      // subtree: a key pressed with focus outside this dialog belongs to
      // whatever holds focus, never to us.
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) return;
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
        className="flex h-[min(640px,calc(100vh-3rem))] w-full max-w-[860px] overflow-hidden rounded-2xl border border-hairline/50 bg-panel shadow-2xl outline-none"
      >
        {/* section nav */}
        <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r border-hairline/40 p-3">
          {/* shrink-0 on the two fixed rows: the title has overflow hidden
              (truncate), which lets a flex column shrink it to absorb an
              overflowing section list — the name's top got clipped. The
              list below scrolls instead. */}
          <div id="bot-settings-title" className="shrink-0 truncate px-2 py-3 text-[15px] font-semibold text-ink">
            {bot.name}
          </div>
          <div className="mb-2 mt-1 flex shrink-0 items-center gap-2 rounded-lg bg-control/70 px-2.5 py-2">
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
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
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
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px]",
                  section === id ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/50 hover:text-ink",
                )}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
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
              (overview === null && overviewError ? (
                <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">Couldn’t load the overview.</div>
              ) : (
                // Data wins over a transient refetch failure: once an overview has
                // loaded once, a later failed refetch (routines/webhooks/bot-record
                // changed, the request errored) keeps showing it rather than
                // replacing a fully populated card with an error block — the same
                // precedence PromptPreview already gives its own data vs. error.
                <OverviewSection
                  overview={overview}
                  refreshError={overview !== null && overviewError}
                  prompt={prompt}
                  promptError={promptError}
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

            {section === "skills" && <SkillsSection bot={bot} />}

            {section === "memory" && <MemorySection bot={bot} />}

            {section === "routines" && (
              <RoutinesSection bot={bot} routines={derived.botRoutines} runs={state.routineRuns} />
            )}

            {section === "access" && <AccessSection bot={bot} derived={derived} />}

            {section === "model" && <ModelSection bot={bot} derived={derived} />}

            {section === "permissions" && <PermissionsSection bot={bot} derived={derived} />}

            {section === "voice" && <VoiceSection bot={bot} derived={derived} />}

            {section === "history" &&
              (historyRows === null && historyError ? (
                <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">Couldn’t load history.</div>
              ) : (
                // Same precedence as the Overview: rows already on screen
                // survive a failed reload (after an undo, say) with a quiet
                // note rather than being replaced by an error block.
                <HistorySection
                  bot={bot}
                  rows={historyRows}
                  refreshError={historyRows !== null && historyError}
                  onRollback={rollbackHistory}
                />
              ))}

            {section === "usage" && <UsageSection bot={bot} />}
          </div>
        </div>
      </div>
    </div>
  );
}
