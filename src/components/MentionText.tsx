import { Fragment } from "react";
import { mentionRanges, type MentionPeer } from "@/lib/mentions";

/** Plain text stays plain text; only known mentions acquire decoration. */
export function MentionText({ text, peers, everyone = false }: {
  text: string; peers: readonly MentionPeer[]; everyone?: boolean;
}) {
  let end = 0;
  const parts = mentionRanges(text, peers, everyone).map((range) => {
    const prefix = text.slice(end, range.start);
    end = range.end;
    return <Fragment key={range.start}>{prefix}<span className="mention-highlight">{text.slice(range.start, range.end)}</span></Fragment>;
  });
  return <>{parts}{text.slice(end)}</>;
}
