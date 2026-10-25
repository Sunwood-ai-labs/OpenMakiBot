const MAX_BUBBLE_BYTES = 28 * 1024;
const MAX_CONTAINER_COMPONENTS = 50;
const MAX_ALT_TEXT_CODE_POINTS = 400;
const ACCENT = "#7865A8";
const CARD_BACKGROUND = "#F7F4FB";
const ALT_TEXT = "表形式の内容を縦型カードで表示";

type PlainTextComponent = {
  type: "text";
  text: string;
  wrap: true;
  size: "md";
};

type FlexSpan = {
  type: "span";
  text: string;
  weight?: "regular" | "bold";
  color?: string;
};

type SpannedTextComponent = {
  type: "text";
  contents: FlexSpan[];
  wrap: true;
  size: "md";
};

type FlexBox = {
  type: "box";
  layout: "vertical";
  contents: FlexComponent[];
  spacing?: "sm" | "md";
  paddingAll?: "md";
  backgroundColor?: string;
  cornerRadius?: "md";
};

type FlexSeparator = {
  type: "separator";
  margin: "sm";
  color: string;
};

type FlexComponent = PlainTextComponent | SpannedTextComponent | FlexBox | FlexSeparator;

type FlexBubble = {
  type: "bubble";
  size: "mega";
  body: FlexBox;
};

export type LineMessage =
  | { type: "text"; text: string }
  | { type: "flex"; altText: string; contents: FlexBubble };

type TableBlock = {
  kind: "table";
  headers: string[];
  rows: string[][];
};

type ProseBlock = { kind: "prose"; text: string };
type ContentBlock = TableBlock | ProseBlock;

type RowScan =
  | { kind: "row"; cells: string[] }
  | { kind: "not-row" }
  | { kind: "uncertain" };

type TableScan =
  | { kind: "table"; block: TableBlock; nextLine: number }
  | { kind: "not-table" }
  | { kind: "malformed" };

function countRun(value: string, start: number, character: string): number {
  let end = start;
  while (value[end] === character) end += 1;
  return end - start;
}

function hasMatchingBacktickRun(value: string, start: number, length: number): boolean {
  for (let index = start; index < value.length;) {
    if (value[index] !== "`") {
      index += 1;
      continue;
    }
    const runLength = countRun(value, index, "`");
    if (runLength === length) return true;
    index += runLength;
  }
  return false;
}

function scanPipeRow(line: string): RowScan {
  const cells = [""];
  const separatorPositions: number[] = [];
  let codeRunLength = 0;

  for (let index = 0; index < line.length;) {
    const character = line[index];

    if (character === "\\") {
      const slashCount = countRun(line, index, "\\");
      const next = line[index + slashCount];
      if (next === "|" && codeRunLength === 0) {
        cells[cells.length - 1] += "\\".repeat(Math.floor(slashCount / 2));
        if (slashCount % 2 === 1) {
          cells[cells.length - 1] += "|";
        } else {
          separatorPositions.push(index + slashCount);
          cells.push("");
        }
        index += slashCount + 1;
        continue;
      }
      if (next === "|" && codeRunLength > 0) {
        cells[cells.length - 1] += `${"\\".repeat(slashCount)}|`;
        index += slashCount + 1;
        continue;
      }
      if (next === "`" && codeRunLength === 0 && slashCount % 2 === 1) {
        cells[cells.length - 1] += "\\".repeat(Math.floor(slashCount / 2));
        const escapedLength = countRun(line, index + slashCount, "`");
        cells[cells.length - 1] += next.repeat(escapedLength);
        index += slashCount + escapedLength;
        continue;
      }
      cells[cells.length - 1] += "\\".repeat(slashCount);
      index += slashCount;
      continue;
    }

    if (character === "`") {
      const runLength = countRun(line, index, "`");
      if (codeRunLength === runLength) {
        codeRunLength = 0;
      } else if (codeRunLength === 0 && hasMatchingBacktickRun(line, index + runLength, runLength)) {
        codeRunLength = runLength;
      } else {
        cells[cells.length - 1] += "`".repeat(runLength);
      }
      index += runLength;
      continue;
    }

    if (character === "|" && codeRunLength === 0) {
      separatorPositions.push(index);
      cells.push("");
    } else {
      cells[cells.length - 1] += character;
    }
    index += 1;
  }

  if (separatorPositions.length === 0) return { kind: "not-row" };
  if (codeRunLength !== 0) return { kind: "uncertain" };

  const firstSeparator = separatorPositions[0];
  if (firstSeparator !== undefined && line.slice(0, firstSeparator).trim() === "") cells.shift();
  const lastSeparator = separatorPositions.at(-1);
  if (lastSeparator !== undefined && line.slice(lastSeparator + 1).trim() === "") cells.pop();

  return {
    kind: "row",
    cells: cells.map((cell) => cell.trim()),
  };
}

function delimiterLike(cells: readonly string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function isDelimiterRow(cells: readonly string[], columnCount: number): boolean {
  return cells.length === columnCount && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isIndentedCodeLine(line: string): boolean {
  if (line.trim() === "") return false;

  let columns = 0;
  for (const character of line) {
    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += 4 - (columns % 4);
    } else {
      return false;
    }

    if (columns >= 4) return true;
  }

  return false;
}

function isFenceOpening(line: string): { character: "`" | "~"; length: number } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  const marker = match?.[1];
  if (!marker) return undefined;
  return { character: marker.startsWith("`") ? "`" : "~", length: marker.length };
}

function closesFence(line: string, fence: { character: "`" | "~"; length: number }): boolean {
  const match = /^ {0,3}(`+|~+)\s*$/.exec(line);
  const marker = match?.[1];
  return marker !== undefined && marker[0] === fence.character && marker.length >= fence.length;
}

function scanTable(lines: readonly string[], lineIndex: number): TableScan {
  const headerLine = lines[lineIndex] ?? "";
  const delimiterLine = lines[lineIndex + 1] ?? "";
  if (isIndentedCodeLine(headerLine) || isIndentedCodeLine(delimiterLine)) return { kind: "not-table" };

  const headerScan = scanPipeRow(headerLine);
  const delimiterScan = scanPipeRow(delimiterLine);
  const delimiterCells = delimiterScan.kind === "row" ? delimiterScan.cells : [];
  if (delimiterScan.kind !== "row" || !delimiterLike(delimiterCells)) return { kind: "not-table" };
  if (headerScan.kind !== "row" || headerScan.cells.length < 2 || !isDelimiterRow(delimiterCells, headerScan.cells.length)) {
    return { kind: "malformed" };
  }

  const rows: string[][] = [];
  let nextLine = lineIndex + 2;
  while (nextLine < lines.length) {
    const line = lines[nextLine] ?? "";
    if (line.trim() === "" || isFenceOpening(line) || isIndentedCodeLine(line)) break;
    const rowScan = scanPipeRow(line);
    if (rowScan.kind === "not-row") break;
    if (rowScan.kind !== "row" || rowScan.cells.length !== headerScan.cells.length) return { kind: "malformed" };
    rows.push(rowScan.cells);
    nextLine += 1;
  }

  if (rows.length === 0) return { kind: "malformed" };
  return {
    kind: "table",
    block: { kind: "table", headers: headerScan.cells, rows },
    nextLine,
  };
}

function parseContent(text: string): { kind: "parsed"; blocks: ContentBlock[] } | { kind: "no-table" | "malformed" } {
  const lines = text.split(/\r\n|\n|\r/);
  const blocks: ContentBlock[] = [];
  const proseLines: string[] = [];
  let fence: { character: "`" | "~"; length: number } | undefined;
  let tableCount = 0;

  const flushProse = () => {
    while (proseLines[0]?.trim() === "") proseLines.shift();
    while (proseLines.at(-1)?.trim() === "") proseLines.pop();
    if (proseLines.length > 0) blocks.push({ kind: "prose", text: proseLines.join("\n") });
    proseLines.length = 0;
  };

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const line = lines[lineIndex] ?? "";
    if (fence) {
      proseLines.push(line);
      if (closesFence(line, fence)) fence = undefined;
      lineIndex += 1;
      continue;
    }

    const opening = isFenceOpening(line);
    if (opening) {
      proseLines.push(line);
      fence = opening;
      lineIndex += 1;
      continue;
    }

    if (isIndentedCodeLine(line)) {
      proseLines.push(line);
      lineIndex += 1;
      continue;
    }

    const table = scanTable(lines, lineIndex);
    if (table.kind === "malformed") return { kind: "malformed" };
    if (table.kind === "table") {
      flushProse();
      blocks.push(table.block);
      tableCount += 1;
      lineIndex = table.nextLine;
      continue;
    }

    proseLines.push(line);
    lineIndex += 1;
  }

  flushProse();
  return tableCount > 0 ? { kind: "parsed", blocks } : { kind: "no-table" };
}

function displayCell(value: string): string {
  return value.length === 0 ? "—" : value;
}

function rowCard(headers: readonly string[], row: readonly string[]): FlexBox {
  const title = displayCell(row[0] ?? "");
  const contents: FlexComponent[] = [
    {
      type: "text",
      contents: [
        { type: "span", text: `${displayCell(headers[0] ?? "")}: ` },
        { type: "span", text: title, weight: "bold", color: ACCENT },
      ],
      wrap: true,
      size: "md",
    },
  ];

  for (let column = 1; column < headers.length; column += 1) {
    const label = displayCell(headers[column] ?? "");
    const value = displayCell(row[column] ?? "");
    contents.push({
      type: "text",
      contents: [
        { type: "span", text: `${label}: `, weight: "bold" },
        { type: "span", text: value },
      ],
      wrap: true,
      size: "md",
    });
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "md",
    backgroundColor: CARD_BACKGROUND,
    cornerRadius: "md",
    contents,
  };
}

function toFlexBubble(blocks: readonly ContentBlock[]): FlexBubble {
  const contents: FlexComponent[] = [];
  for (const block of blocks) {
    if (block.kind === "prose") {
      contents.push({ type: "text", text: block.text, wrap: true, size: "md" });
      continue;
    }

    block.rows.forEach((row, index) => {
      if (index > 0) contents.push({ type: "separator", margin: "sm", color: "#E7E0F0" });
      contents.push(rowCard(block.headers, row));
    });
  }

  return {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", spacing: "md", contents },
  };
}

function hasValidComponentCounts(component: FlexComponent): boolean {
  if (component.type !== "box") return true;
  return component.contents.length <= MAX_CONTAINER_COMPONENTS && component.contents.every(hasValidComponentCounts);
}

export function formatLineMessage(text: string): LineMessage {
  const parsed = parseContent(text);
  if (parsed.kind !== "parsed") return { type: "text", text };

  const contents = toFlexBubble(parsed.blocks);
  const bubbleJson = JSON.stringify(contents);
  if (
    Buffer.byteLength(bubbleJson, "utf8") > MAX_BUBBLE_BYTES
    || Array.from(ALT_TEXT).length > MAX_ALT_TEXT_CODE_POINTS
    || !hasValidComponentCounts(contents.body)
  ) {
    return { type: "text", text };
  }

  return { type: "flex", altText: ALT_TEXT, contents };
}
