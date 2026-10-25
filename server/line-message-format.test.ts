import { describe, expect, it } from "vitest";

import { formatLineMessage, type LineMessage } from "./line-message-format.ts";

function visibleText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(visibleText);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === "text" && typeof child === "string") return [child];
    return visibleText(child);
  });
}

function expectFlex(message: LineMessage): Extract<LineMessage, { type: "flex" }> {
  if (message.type !== "flex") throw new Error("Expected a Flex Message.");
  return message;
}

describe("formatLineMessage", () => {
  it("renders a three-column, fourteen-row table as readable vertical cards and keeps all values in order", () => {
    const rows = [
      ["代表: ねこ", "対応中", "絵文字と長い名前 🐈‍⬛"],
      [`長い担当者 ${"森田".repeat(45)}`, "完了", "長い名前を縮小せず折り返す"],
      ...Array.from({ length: 12 }, (_, index) => [`担当 ${index + 3}`, `状態 ${index + 3}`, `説明 ${index + 3} — 詳細`]),
    ];
    const input = [
      "今日の進捗です。",
      "",
      "| 名前 | 状態 | 詳細 |",
      "| --- | :---: | ---: |",
      ...rows.map((row) => `| ${row.join(" | ")} |`),
      "",
      "以上です。",
    ].join("\n");

    const result = expectFlex(formatLineMessage(input));
    const body = result.contents.body.contents;
    const cards = body.filter((component) => component.type === "box");
    const separators = body.filter((component) => component.type === "separator");
    const renderedValues = visibleText(result.contents);

    expect(result.altText).toBe("表形式の内容を縦型カードで表示");
    expect(Array.from(result.altText).length).toBeLessThanOrEqual(400);
    expect(body[0]).toMatchObject({ type: "text", text: "今日の進捗です。", wrap: true, size: "md" });
    expect(body.at(-1)).toMatchObject({ type: "text", text: "以上です。", wrap: true, size: "md" });
    expect(cards).toHaveLength(14);
    expect(separators).toHaveLength(13);
    const firstCard = cards[0];
    if (!firstCard || firstCard.type !== "box") throw new Error("Expected the first table row to be a card.");
    expect(firstCard.layout).toBe("vertical");
    expect(firstCard.contents[0]).toMatchObject({
      type: "text",
      contents: [{ text: "名前: " }, { text: "代表: ねこ", weight: "bold" }],
      wrap: true,
      size: "md",
    });
    expect(firstCard.contents[1]).toMatchObject({
      type: "text",
      contents: [{ text: "状態: ", weight: "bold" }, { text: "対応中" }],
      wrap: true,
      size: "md",
    });
    const orderedText = renderedValues.join("");
    let searchFrom = 0;
    for (const row of rows) {
      for (const cell of row) {
        const cellPosition = orderedText.indexOf(cell, searchFrom);
        expect(cellPosition).toBeGreaterThanOrEqual(searchFrom);
        searchFrom = cellPosition + cell.length;
      }
    }
    expect(renderedValues).toContain("名前: ");
    expect(renderedValues).toContain("状態: ");
    expect(renderedValues).toContain("詳細: ");
    expect(JSON.stringify(result.contents)).not.toMatch(/"type":"(?:button|table)"|"action":/);
    expect(Buffer.byteLength(JSON.stringify(result.contents), "utf8")).toBeLessThanOrEqual(28 * 1024);
  });

  it("returns ordinary text byte-for-byte when it has no table", () => {
    const input = "通常の文章です。\r\n値はそのまま返します。";
    expect(formatLineMessage(input)).toEqual({ type: "text", text: input });
  });

  it("does not interpret a table inside a fenced code block", () => {
    const input = ["```md", "| name | value |", "| --- | --- |", "| Alice | 1 |", "```"].join("\n");
    expect(formatLineMessage(input)).toEqual({ type: "text", text: input });
  });

  it("preserves four-space and tab-indented pipe tables as literal code", () => {
    const fourSpaceInput = [
      "    | Name | Value |",
      "    | --- | --- |",
      "    | Ada | 1 |",
    ].join("\n");
    const tabInput = [
      "\t| Name | Value |",
      "\t| --- | --- |",
      "\t| Ada | 1 |",
    ].join("\n");

    expect(formatLineMessage(fourSpaceInput)).toEqual({ type: "text", text: fourSpaceInput });
    expect(formatLineMessage(tabInput)).toEqual({ type: "text", text: tabInput });
  });

  it("keeps indented code separate while rendering a valid table elsewhere", () => {
    const code = [
      "    | Name | Value |",
      "    | --- | --- |",
      "    | Ada | 1 |",
    ].join("\n");
    const input = [
      "Summary",
      "",
      "| Item | Value |",
      "| --- | --- |",
      "| Actual | 1 |",
      "",
      code,
    ].join("\n");

    const result = expectFlex(formatLineMessage(input));
    expect(visibleText(result.contents)).toContain(code);
    expect(result.contents.body.contents.filter((component) => component.type === "box")).toHaveLength(1);
  });

  it("does not accept indentation in a table header, delimiter, or body row", () => {
    const inputs = [
      ["    | Name | Value |", "| --- | --- |", "| Ada | 1 |"],
      ["| Name | Value |", "    | --- | --- |", "| Ada | 1 |"],
      ["| Name | Value |", "| --- | --- |", "    | Ada | 1 |"],
    ].map((lines) => lines.join("\n"));

    for (const input of inputs) {
      expect(formatLineMessage(input)).toEqual({ type: "text", text: input });
    }
  });

  it("falls back unchanged for a malformed table instead of dropping a cell", () => {
    const input = ["| 名前 | 状態 | 詳細 |", "| --- | --- | --- |", "| ねこ | 完了 | 値 | extra |"].join("\n");
    expect(formatLineMessage(input)).toEqual({ type: "text", text: input });
  });

  it("keeps escaped pipes and pipes inside inline code as visible cell text", () => {
    const input = [
      "| 名前 | 詳細 |",
      "| --- | --- |",
      "| alpha\\|beta | `left|right` |",
      "| gamma | `slash\\|pipe` |",
    ].join("\n");
    const result = expectFlex(formatLineMessage(input));
    const text = visibleText(result.contents);
    expect(text).toContain("alpha|beta");
    expect(text).toContain("left|right");
    expect(text).toContain("slash\\|pipe");
    expect(text).not.toContain("alpha\\|beta");
    expect(text).not.toContain("`left|right`");
  });

  it("preserves metadata characters and displays empty cells without inventing stored values", () => {
    const metadata = String.raw`<tag> & "quoted" 'apostrophe' \\path`;
    const input = ["| 項目 | メタデータ | 空欄 |", "| --- | --- | --- |", `| 設定 | ${metadata} |  |`].join("\n");
    const result = expectFlex(formatLineMessage(input));
    const text = visibleText(result.contents);
    expect(text).toContain(metadata);
    expect(text).toContain("空欄: ");
    expect(text).toContain("—");
  });

  it("returns the complete original table when the Flex bubble exceeds the conservative byte budget", () => {
    const input = [
      "| 名前 | 詳細 |",
      "| --- | --- |",
      `| 大きな値 | ${"漢字".repeat(5000)} |`,
    ].join("\n");
    expect(formatLineMessage(input)).toEqual({ type: "text", text: input });
  });
});
