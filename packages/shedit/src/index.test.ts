import { describe, expect, test } from "bun:test";
import {
  applyAutoPairBackspace,
  applyAutoPairInsert,
  cutWholeLine,
  duplicateLines,
  indentLineBlock,
  isTypingUndoBoundary,
  lineHasContent,
  lineRangeOffsets,
  outdentLineBlock,
  selectionLineRange,
  shouldAutoPairQuote,
  splitDocumentValue,
  toggleLineComments,
} from "./lib.ts";
import { normalizeEditorDocument, stripTwoslashAnnotationLines } from "./twoslash.ts";

describe("splitDocumentValue", () => {
  test("empty string is one empty line", () => {
    expect(splitDocumentValue("")).toEqual([""]);
  });

  test("splits on newlines", () => {
    expect(splitDocumentValue("a\nb")).toEqual(["a", "b"]);
  });
});

describe("lineHasContent", () => {
  test("detects non-whitespace", () => {
    expect(lineHasContent("  x")).toBe(true);
    expect(lineHasContent("   ")).toBe(false);
    expect(lineHasContent("")).toBe(false);
  });
});

describe("indentLineBlock", () => {
  const tab = 2;

  test("indents current line at caret", () => {
    const src = "foo";
    const { value, start, end } = indentLineBlock(src, 0, 0, tab);
    expect(value).toBe("  foo");
    expect(start).toBe(2);
    expect(end).toBe(2);
  });

  test("indents empty and whitespace-only lines in selection", () => {
    const src = "a\n   \nb";
    const line2Start = src.indexOf("b");
    const { value } = indentLineBlock(src, 0, line2Start + 1, tab);
    expect(value).toBe("  a\n     \n  b");
  });

  test("indents all lines in block selection", () => {
    const src = "one\ntwo";
    const { value } = indentLineBlock(src, 0, src.length, tab);
    expect(value).toBe("  one\n  two");
  });
});

describe("outdentLineBlock", () => {
  test("removes up to tabSize leading spaces", () => {
    const src = "  hello";
    const { value, start } = outdentLineBlock(src, 2, 2, 2);
    expect(value).toBe("hello");
    expect(start).toBe(0);
  });

  test("outdents multiple lines in selection", () => {
    const src = "  a\n  b";
    const { value } = outdentLineBlock(src, 0, src.length, 2);
    expect(value).toBe("a\nb");
  });
});

describe("toggleLineComments", () => {
  test("comments uncommented lines", () => {
    const src = "const x = 1";
    const { value } = toggleLineComments(src, 0, src.length);
    expect(value).toBe("// const x = 1");
  });

  test("preserves indent when commenting", () => {
    const src = "  const x = 1";
    const { value } = toggleLineComments(src, 0, src.length);
    expect(value).toBe("  // const x = 1");
  });

  test("uncomments when all selected lines are commented", () => {
    const src = "// a\n// b";
    const { value } = toggleLineComments(src, 0, src.length);
    expect(value).toBe("a\nb");
  });

  test("toggles two lines independently", () => {
    const src = "a\nb";
    const mid = src.indexOf("b");
    const { value: commented } = toggleLineComments(src, 0, src.length);
    expect(commented).toBe("// a\n// b");
    const { value: restored } = toggleLineComments(commented, 0, commented.length);
    expect(restored).toBe("a\nb");
  });
});

describe("duplicateLines", () => {
  test("duplicates single line below with collapsed caret on copy", () => {
    const src = "only";
    const { value, start, end } = duplicateLines(src, 2, 2);
    expect(value).toBe("only\nonly");
    expect(start).toBe(end);
    expect(value[start]).toBe("l");
  });

  test("duplicate at EOL does not insert blank lines between copies", () => {
    const src = "only\n";
    const pos = src.length;
    const once = duplicateLines(src, pos, pos);
    expect(once.value).toBe("only\nonly\n");
    const pos2 = once.value.length;
    const twice = duplicateLines(once.value, pos2, pos2);
    expect(twice.value).toBe("only\nonly\nonly\n");
    expect(twice.value).not.toContain("\n\n\n");
  });

  test("duplicates multi-line selection", () => {
    const src = "a\nb";
    const { value, start, end } = duplicateLines(src, 0, src.length);
    expect(value).toBe("a\nb\na\nb");
    expect(start).toBe(end);
  });
});

describe("cutWholeLine", () => {
  test("cuts middle line with trailing newline", () => {
    const src = "a\nb\nc";
    const pos = src.indexOf("b");
    const { value, cutText } = cutWholeLine(src, pos);
    expect(cutText).toBe("b\n");
    expect(value).toBe("a\nc");
  });

  test("cuts first line", () => {
    const src = "first\nsecond";
    const { value, cutText } = cutWholeLine(src, 0);
    expect(cutText).toBe("first\n");
    expect(value).toBe("second");
  });

  test("cuts last line using leading newline", () => {
    const src = "first\nlast";
    const pos = src.indexOf("last");
    const { value, cutText } = cutWholeLine(src, pos);
    expect(cutText).toBe("\nlast");
    expect(value).toBe("first");
  });

  test("single line document", () => {
    const src = "solo";
    const { value, cutText } = cutWholeLine(src, 2);
    expect(cutText).toBe("solo");
    expect(value).toBe("");
  });
});

describe("selectionLineRange & lineRangeOffsets", () => {
  test("caret line range", () => {
    const src = "a\nb\nc";
    expect(selectionLineRange(src, 3, 3)).toEqual([1, 1]);
  });

  test("multi-line selection range", () => {
    const src = "a\nb\nc";
    expect(selectionLineRange(src, 0, 5)).toEqual([0, 2]);
  });

  test("line offsets for single line in file (includes following newline when not last line)", () => {
    const src = "a\nb\nc";
    expect(lineRangeOffsets(src, 1, 1)).toEqual([2, 4]);
  });
});

describe("shouldAutoPairQuote", () => {
  test("allows pair when not escaped and next char is not same quote", () => {
    expect(shouldAutoPairQuote("ab", 1)).toBe(true);
  });

  test("disallows after backslash", () => {
    expect(shouldAutoPairQuote("a\\", 2)).toBe(false);
  });

  test("disallows when next char is a quote", () => {
    expect(shouldAutoPairQuote('a"', 1)).toBe(false);
  });
});

describe("applyAutoPairInsert", () => {
  test("wraps with brackets", () => {
    const r = applyAutoPairInsert("ab", 1, "(");
    expect(r).toEqual({ value: "a()b", start: 2, end: 2 });
  });

  test("wraps with quotes", () => {
    const r = applyAutoPairInsert("x", 1, '"');
    expect(r).toEqual({ value: 'x""', start: 2, end: 2 });
  });
});

describe("applyAutoPairBackspace", () => {
  test("removes empty pair", () => {
    const src = "a()b";
    const r = applyAutoPairBackspace(src, 2);
    expect(r).toEqual({ value: "ab", start: 1, end: 1 });
  });

  test("removes empty quotes", () => {
    const src = 'a""b';
    const r = applyAutoPairBackspace(src, 2);
    expect(r).toEqual({ value: "ab", start: 1, end: 1 });
  });

  test("no-op when not empty pair", () => {
    expect(applyAutoPairBackspace("a(b)", 2)).toBeNull();
  });
});

describe("isTypingUndoBoundary", () => {
  test("space and punctuation break batches", () => {
    expect(isTypingUndoBoundary(" ")).toBe(true);
    expect(isTypingUndoBoundary(".")).toBe(true);
    expect(isTypingUndoBoundary("a")).toBe(false);
  });
});

describe("twoslash document normalization", () => {
  test("stripTwoslashAnnotationLines removes handbook lines", () => {
    const src = "const x = 1\n// ^?\n";
    expect(stripTwoslashAnnotationLines(src)).toBe("const x = 1\n");
  });

  test("normalizeEditorDocument strips when twoslash active", () => {
    const src = "const x = 1\n// ^|\n";
    expect(normalizeEditorDocument(src, true)).toBe("const x = 1\n");
    expect(normalizeEditorDocument(src, false)).toBe(src);
  });
});
