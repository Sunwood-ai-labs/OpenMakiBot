// History: every change recorded against this bot's profile (name, title,
// instructions, soul, and the rest of PROFILE_REQUEST_FIELDS), newest
// first. Server-built list — GET /api/bots/:id/history — and a soul row
// carries a rollback: POST /api/bots/:id/history/rollback { at } restores
// that row's previous SOUL.md text (labeled "Undo", not "Restore" — it
// applies the previous text, it doesn't reopen an old version to edit).
// Pure presentational: the dialog owns the fetch, the reload after rollback,
// and the loading/error split — a first-load failure never reaches this
// component (the dialog shows "Couldn't load history." instead); a failed
// reload with rows already on screen arrives as refreshError, the same
// data-wins precedence OverviewSection gets one level up.
import { whenLabel } from "@/lib/schedule-label";

export interface HistoryRow {
  at: number;
  actor: string;
  via: string;
  field: string;
  summary: string;
  before?: string;
  after?: string;
}

export function HistorySection({
  bot,
  rows,
  refreshError,
  onRollback,
}: {
  bot: { id: string };
  rows: HistoryRow[] | null;
  refreshError?: boolean;
  onRollback: (at: number) => void;
}) {
  if (!rows) {
    return <div className="text-[13px] text-ink-secondary">Loading…</div>;
  }
  if (rows.length === 0) {
    return <div className="text-[13px] text-ink-secondary">No changes recorded yet.</div>;
  }

  const sorted = [...rows].sort((a, b) => b.at - a.at);

  return (
    <div className="flex flex-col gap-2">
      {refreshError && (
        <div className="rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary">Couldn’t refresh history.</div>
      )}
      {/* Index keys: one recordProfileChange call can write several rows
          with the same `at` and even the same field, so no row field set
          is unique; the list is replaced wholesale on every load anyway. */}
      {sorted.map((row, i) => (
        <div key={`${bot.id}-${i}`} className="rounded-xl bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
              <span className="text-ink-secondary">{whenLabel(row.at)}</span>
              {" · "}
              <span>
                {row.actor} via {row.via}
              </span>
              {" · "}
              <span>{row.summary}</span>
            </div>
            {row.field === "soul" && (
              <button
                type="button"
                onClick={() => onRollback(row.at)}
                className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10"
              >
                Undo this change
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
