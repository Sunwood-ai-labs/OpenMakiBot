/** Byte length as the server counts it: the soul cap is a UTF-8 budget. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The blurb a long description collapses to when it moves into SOUL.md:
 * the first sentence, or the first line, capped. */
export function firstSentence(text: string, max = 200): string {
  const line = text.trim().split("\n")[0] ?? "";
  const match = line.match(/^.*?[.!?](?=\s|$)/);
  const sentence = (match ? match[0] : line).trim();
  return sentence.slice(0, max);
}
