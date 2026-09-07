export type MentionPeer = { name: string; hidden?: boolean };
export type MentionRange = { start: number; end: number };

/** Display the same word-start, longest-name matches as server/store.ts.
 * Keep offsets in the original string so casing and Unicode remain intact. */
export function mentionRanges(text: string, peers: readonly MentionPeer[], everyone = false): MentionRange[] {
  const names = peers.filter((p) => !p.hidden && p.name.trim()).map((p) => p.name)
    .sort((a, b) => b.length - a.length);
  const ranges: MentionRange[] = [];
  let at = -1;
  while ((at = text.indexOf("@", at + 1)) !== -1) {
    if (at > 0 && !/\s/.test(text[at - 1])) continue;
    const rest = text.slice(at + 1);
    const name = names.find((name) => rest.slice(0, name.length).toLowerCase() === name.toLowerCase()
      && (rest.length === name.length || !/[a-z0-9]/i.test(rest[name.length])));
    const length = everyone && /^everyone\b/i.test(rest) ? 8 : name?.length;
    if (length === undefined) continue;
    ranges.push({ start: at, end: at + length + 1 });
    at += length;
  }
  return ranges;
}

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName: string; hProperties: { className: string } };
};

/** Transform text nodes only: links, code and image metadata stay untouched. */
export function remarkMentions({ peers, everyone = false }: { peers: readonly MentionPeer[]; everyone?: boolean }) {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || ["link", "linkReference", "code", "inlineCode"].includes(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const text = child.value;
        const ranges = mentionRanges(text, peers, everyone);
        if (!ranges.length) return [child];
        const result: MarkdownNode[] = [];
        let end = 0;
        for (const range of ranges) {
          if (range.start > end) result.push({ type: "text", value: text.slice(end, range.start) });
          result.push({ type: "mention", data: { hName: "span", hProperties: { className: "mention-highlight" } },
            children: [{ type: "text", value: text.slice(range.start, range.end) }] });
          end = range.end;
        }
        if (end < text.length) result.push({ type: "text", value: text.slice(end) });
        return result;
      });
    };
    visit(tree);
  };
}
