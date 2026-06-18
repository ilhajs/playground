/** Pure text transforms used by the shedit textarea (unit-testable). */

export function splitDocumentValue(value: string): string[] {
  if (value.length === 0) return [""];
  return value.split("\n");
}

export function isTypingUndoBoundary(text: string): boolean {
  if (!text) return false;
  return /[\s\n\r.,;:!?(){}\[\]<>/\\|&=+\-*"'`]/.test(text);
}

export function offsetFromLineCol(lines: string[], lineIndex: number, col: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += lines[i]!.length + 1;
  return offset + col;
}

export function lineHasContent(text: string): boolean {
  return /\S/.test(text);
}

export function selectionLineRange(value: string, start: number, end: number): [number, number] {
  const lines = value.split("\n");
  const firstLine = value.slice(0, start).split("\n").length - 1;
  if (end === start) return [firstLine, firstLine];

  let lastLine = value.slice(0, end).split("\n").length - 1;
  // Caret/selection ending right after `\n` must not include the phantom empty next line.
  if (end > 0 && value[end - 1] === "\n") {
    const lineStart = offsetFromLineCol(lines, lastLine, 0);
    if (end === lineStart && (lines[lastLine] ?? "") === "") {
      lastLine = Math.max(firstLine, lastLine - 1);
    }
  }
  return [firstLine, lastLine];
}

export function lineRangeOffsets(
  value: string,
  firstLine: number,
  lastLine: number,
): [number, number] {
  const lines = value.split("\n");
  let start = 0;
  for (let i = 0; i < firstLine; i++) start += lines[i]!.length + 1;
  let end = start;
  for (let i = firstLine; i <= lastLine && i < lines.length; i++) {
    end += lines[i]!.length + (i < lines.length - 1 ? 1 : 0);
  }
  return [start, end];
}

export function indentLineBlock(
  value: string,
  start: number,
  end: number,
  tabSize: number,
): { value: string; start: number; end: number } {
  const tab = " ".repeat(tabSize);
  const lines = value.split("\n");
  const lineCount = lines.length;
  const firstLine = value.slice(0, start).split("\n").length - 1;
  const lastLine = end === start ? firstLine : value.slice(0, end).split("\n").length - 1;

  const addedPerLine: number[] = [];
  for (let i = firstLine; i <= lastLine && i < lineCount; i++) {
    lines[i] = tab + lines[i]!;
    addedPerLine.push(tabSize);
  }

  const next = lines.join("\n");
  const oldLines = value.split("\n");
  const oldFirstOffset = offsetFromLineCol(oldLines, firstLine, 0);
  const colStart = start - oldFirstOffset;
  const addStart = addedPerLine[0] ?? 0;
  const newSelStart = offsetFromLineCol(lines, firstLine, colStart + addStart);

  if (end === start) {
    return { value: next, start: newSelStart, end: newSelStart };
  }

  const oldLastOffset = offsetFromLineCol(oldLines, lastLine, 0);
  const colEnd = end - oldLastOffset;
  const addEnd = addedPerLine[addedPerLine.length - 1] ?? 0;
  const newSelEnd = offsetFromLineCol(lines, lastLine, colEnd + addEnd);
  return { value: next, start: newSelStart, end: newSelEnd };
}

export function outdentLineBlock(
  value: string,
  start: number,
  end: number,
  tabSize: number,
): { value: string; start: number; end: number } {
  const lines = value.split("\n");
  const lineCount = lines.length;
  const firstLine = value.slice(0, start).split("\n").length - 1;
  const lastLine = end === start ? firstLine : value.slice(0, end).split("\n").length - 1;
  const re = new RegExp(`^ {1,${tabSize}}`);

  const removedPerLine: number[] = [];
  for (let i = firstLine; i <= lastLine && i < lineCount; i++) {
    const line = lines[i]!;
    const m = line.match(re);
    const removed = m ? m[0]!.length : 0;
    removedPerLine.push(removed);
    if (removed > 0) lines[i] = line.slice(removed);
  }

  const next = lines.join("\n");
  const oldLines = value.split("\n");
  const oldFirstOffset = offsetFromLineCol(oldLines, firstLine, 0);
  const colStart = start - oldFirstOffset;
  const removedStart = removedPerLine[0] ?? 0;
  const newSelStart = offsetFromLineCol(lines, firstLine, Math.max(0, colStart - removedStart));

  if (end === start) {
    return { value: next, start: newSelStart, end: newSelStart };
  }

  const oldLastOffset = offsetFromLineCol(oldLines, lastLine, 0);
  const colEnd = end - oldLastOffset;
  const removedEnd = removedPerLine[removedPerLine.length - 1] ?? 0;
  const newSelEnd = offsetFromLineCol(lines, lastLine, Math.max(0, colEnd - removedEnd));
  return { value: next, start: newSelStart, end: newSelEnd };
}

export function toggleLineComments(
  value: string,
  start: number,
  end: number,
  prefix = "// ",
): { value: string; start: number; end: number } {
  const lines = value.split("\n");
  const [firstLine, lastLine] = selectionLineRange(value, start, end);
  const block = lines.slice(firstLine, lastLine + 1);
  const allCommented = block.every((line) => /^\s*\/\//.test(line));
  const deltaPerLine: number[] = [];

  for (let i = firstLine; i <= lastLine; i++) {
    const line = lines[i]!;
    if (allCommented) {
      const m = line.match(/^(\s*)\/\/\s?/);
      if (m) {
        const removed = m[0]!.length;
        lines[i] = line.slice(removed);
        deltaPerLine.push(-removed);
      } else {
        deltaPerLine.push(0);
      }
    } else {
      const m = line.match(/^(\s*)/);
      const indent = m?.[1] ?? "";
      lines[i] = indent + prefix + line.slice(indent.length);
      deltaPerLine.push(prefix.length);
    }
  }

  const next = lines.join("\n");
  const oldLines = value.split("\n");
  const oldFirst = offsetFromLineCol(oldLines, firstLine, 0);
  const colStart = start - oldFirst;
  const d0 = deltaPerLine[0] ?? 0;
  const newStart = offsetFromLineCol(lines, firstLine, Math.max(0, colStart + d0));

  if (end === start) return { value: next, start: newStart, end: newStart };

  const oldLast = offsetFromLineCol(oldLines, lastLine, 0);
  const colEnd = end - oldLast;
  const dLast = deltaPerLine[deltaPerLine.length - 1] ?? 0;
  const newEnd = offsetFromLineCol(lines, lastLine, Math.max(0, colEnd + dLast));
  return { value: next, start: newStart, end: newEnd };
}

export function duplicateLines(
  value: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } {
  const lines = value.split("\n");
  let [firstLine, lastLine] = selectionLineRange(value, start, end);
  if (start === end && (lines[firstLine] ?? "") === "") {
    const col = start - offsetFromLineCol(lines, firstLine, 0);
    if (col === 0 && firstLine > 0) {
      firstLine = lastLine = firstLine - 1;
    }
  }
  const dup = lines.slice(firstLine, lastLine + 1);
  const insertAt = lastLine + 1;
  const oldFirstOffset = offsetFromLineCol(lines, firstLine, 0);
  const col = start - oldFirstOffset;
  lines.splice(insertAt, 0, ...dup);
  const next = lines.join("\n");
  const newLines = next.split("\n");
  const dupLine = newLines[insertAt] ?? "";
  const caretCol = Math.min(Math.max(0, col), dupLine.length);
  const caret = offsetFromLineCol(newLines, insertAt, caretCol);
  return { value: next, start: caret, end: caret };
}

export function cutWholeLine(
  value: string,
  pos: number,
): { value: string; start: number; end: number; cutText: string } {
  const lines = value.split("\n");
  const lineIndex = value.slice(0, pos).split("\n").length - 1;
  const lineStart = offsetFromLineCol(lines, lineIndex, 0);
  const lineEnd = lineStart + (lines[lineIndex]?.length ?? 0);
  let cutText = value.slice(lineStart, lineEnd);
  let removeStart = lineStart;
  let removeEnd = lineEnd;
  if (lineIndex < lines.length - 1) {
    removeEnd = lineEnd + 1;
    cutText += "\n";
  } else if (lineIndex > 0) {
    removeStart = lineStart - 1;
    cutText = "\n" + cutText;
  }
  const next = value.slice(0, removeStart) + value.slice(removeEnd);
  const newPos = Math.min(removeStart, next.length);
  return { value: next, start: newPos, end: newPos, cutText };
}

export function shouldAutoPairQuote(value: string, pos: number): boolean {
  if (value[pos - 1] === "\\") return false;
  const after = value[pos];
  const quoteChars = new Set(['"', "'", "`"]);
  if (after !== undefined && quoteChars.has(after)) return false;
  return true;
}

/** Simulate typing an open bracket/quote with auto-pair (caret inside). */
export function applyAutoPairInsert(
  value: string,
  pos: number,
  open: string,
): { value: string; start: number; end: number } | null {
  const bracketClose: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const openSet = new Set(["(", "[", "{"]);
  const quotes = new Set(['"', "'", "`"]);

  if (openSet.has(open)) {
    const close = bracketClose[open]!;
    const next = value.slice(0, pos) + open + close + value.slice(pos);
    return { value: next, start: pos + 1, end: pos + 1 };
  }
  if (quotes.has(open) && shouldAutoPairQuote(value, pos)) {
    const next = value.slice(0, pos) + open + open + value.slice(pos);
    return { value: next, start: pos + 1, end: pos + 1 };
  }
  return null;
}

/** Simulate Backspace on an empty auto-paired bracket or quote. */
export function applyAutoPairBackspace(
  value: string,
  pos: number,
): { value: string; start: number; end: number } | null {
  if (pos <= 0) return null;
  const open = value[pos - 1];
  const close = value[pos];
  const bracketOpen = new Set(["(", "[", "{"]);
  const bracketClose: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const quotes = new Set(['"', "'", "`"]);
  const pairedBracket = open && close && bracketOpen.has(open) && bracketClose[open] === close;
  const pairedQuote = open && close && open === close && quotes.has(open);
  if (!pairedBracket && !pairedQuote) return null;
  const next = value.slice(0, pos - 1) + value.slice(pos + 1);
  return { value: next, start: pos - 1, end: pos - 1 };
}
