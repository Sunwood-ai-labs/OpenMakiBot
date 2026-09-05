// History: every change recorded against this bot's profile (name, title,
// instructions, soul, and the rest of PROFILE_REQUEST_FIELDS), newest
// first. Server-built list — GET /api/bots/:id/history — and a soul row
// carries a rollback: POST /api/bots/:id/history/rollback { at } restores
// that row's previous SOUL.md text (labeled "Undo", not "Restore" — it
// applies the previous text, it doesn't reopen an old version to edit).
// Pure presentational: the dialog owns the fetch, the reload after rollback,
// and the loading/error split (a fetch failure never reaches this
// component — the dialog shows "Couldn't load history." instead, the same
// way OverviewSection's fetch failure is handled one level up).
export interface HistoryRow {
  at: number;
  actor: string;
  via: string;
  field: string;
  summary: string;
  before?: string;
  after?: string;
}

function formatWhen(at: number): string {
  const date = new Date(at);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function HistorySection({
  bot,
  rows,
  onRollback,
}: {
  bot: { id: string };
  rows: HistoryRow[] | null;
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
      {sorted.map((row) => (
        <div key={`${bot.id}-${row.at}-${row.field}`} className="rounded-xl bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
              <span className="text-ink-secondary">{formatWhen(row.at)}</span>
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
