import ilha, { html } from "ilha";
import type { BundledLanguage, BundledTheme, HighlighterCore, ThemedToken } from "shiki";
import {
  applyTwoslashOverlayHtml,
  bindTwoslashUi,
  isTwoslashLanguage,
  mapCursorAfterStripAnnotationLines,
  normalizeEditorDocument,
  renderTwoslashMirrorHtml,
  type TwoslashEditorOptions,
} from "./twoslash.ts";
import {
  cutWholeLine,
  duplicateLines,
  indentLineBlock,
  isTypingUndoBoundary,
  outdentLineBlock,
  shouldAutoPairQuote,
  splitDocumentValue,
  toggleLineComments,
} from "./lib.ts";

export {
  codeToHighlightHtml,
  loadBundledLanguage,
  loadCustomLanguage,
  createCustomHighlighter,
} from "shiki-highlight-api";
export type { HighlightOptions, HighlightResult } from "shiki-highlight-api";
export type { TwoslashEditorOptions, TwoslashUiController } from "./twoslash.ts";
export {
  isTwoslashLanguage,
  normalizeEditorDocument,
  stripTwoslashAnnotationLines,
} from "./twoslash.ts";

// ─── 1. Types ─────────────────────────────────────────────────────────────────

type GrammarState = NonNullable<ReturnType<HighlighterCore["codeToTokens"]>["grammarState"]>;

interface LineRecord {
  text: string;
  tokens: ThemedToken[];
  grammarState: GrammarState | undefined;
  grammarHash: string;
  dirty: boolean;
}

export type SheditThemeMode = "system" | "light" | "dark";

export type ShikiEditorInput = {
  shiki: HighlighterCore;
  lang: BundledLanguage;
  /** Shiki multi-theme map; use `light` and `dark` keys when possible. */
  themes: Record<string, BundledTheme>;
  theme?: SheditThemeMode;
  lineHeight?: number;
  tabSize?: number;
  padX?: number;
  padY?: number;
  fontSize?: number;
  fontFamily?: string;
  value?: string;
  /** Shown when the document is empty (native `placeholder` is unreliable with a syntax mirror). */
  placeholder?: string;
  ariaLabel?: string;
  /**
   * Twoslash type hints for TS/JS/TSX (on by default). Opt out with `false`.
   * `true` or omit = defaults (`peekHoverMs: 1000`, debounced overlay).
   */
  twoslash?: boolean | import("./twoslash.ts").TwoslashEditorOptions;
  onChange?: (value: string) => void;
};

export interface ShikiEditorHandle {
  setValue(value: string): void;
  getValue(): string;
  setLang(newLang: BundledLanguage): void;
  getLang(): BundledLanguage;
  /** Replace the change listener (e.g. parent cannot pass functions through Ilha props). */
  setOnChange(callback: ((value: string) => void) | undefined): void;
  dispose(): void;
}

type LineHighlightInput = {
  lineIndex: number;
  text: string;
  tokens: ThemedToken[];
};

type LayoutMetrics = {
  lineHeight: number;
  tabSize: number;
  padX: number;
  padY: number;
  fontSize: number;
  fontFamily: string;
};

type EditorView = {
  host: HTMLElement;
  gutter: HTMLDivElement;
  /** CSS Custom Highlight layer (always updated while typing) */
  mirrorHl: HTMLPreElement;
  /** Twoslash hovers / errors (debounced, transparent text) */
  mirrorTwoslash: HTMLPreElement | null;
  textarea: HTMLTextAreaElement;
};

type MirrorHighlightController = {
  renderLines(lines: LineHighlightInput[]): void;
  updateLineTexts(lines: LineHighlightInput[]): void;
  reapplyHighlights(): void;
  dispose(): void;
};

// ─── 2. BEM + shell + layout ──────────────────────────────────────────────────

const BLOCK = "shedit";

const DEFAULT_LAYOUT: LayoutMetrics = {
  lineHeight: 22,
  tabSize: 2,
  padX: 16,
  padY: 16,
  fontSize: 14,
  fontFamily: 'ui-monospace, "JetBrains Mono", "Fira Code", monospace',
};

function resolveLayout(input: ShikiEditorInput): LayoutMetrics {
  return {
    lineHeight: input.lineHeight ?? DEFAULT_LAYOUT.lineHeight,
    tabSize: input.tabSize ?? DEFAULT_LAYOUT.tabSize,
    padX: input.padX ?? DEFAULT_LAYOUT.padX,
    padY: input.padY ?? DEFAULT_LAYOUT.padY,
    fontSize: input.fontSize ?? DEFAULT_LAYOUT.fontSize,
    fontFamily: input.fontFamily ?? DEFAULT_LAYOUT.fontFamily,
  };
}

function applyLayout(host: HTMLElement, layout: LayoutMetrics): void {
  host.style.setProperty("--shedit-line-height", `${layout.lineHeight}px`);
  host.style.setProperty("--shedit-tab-size", String(layout.tabSize));
  host.style.setProperty("--shedit-pad-x", `${layout.padX}px`);
  host.style.setProperty("--shedit-pad-y", `${layout.padY}px`);
  host.style.setProperty("--shedit-font-size", `${layout.fontSize}px`);
  host.style.setProperty("--shedit-font-family", layout.fontFamily);
}

function clearLayout(host: HTMLElement): void {
  for (const key of [
    "--shedit-line-height",
    "--shedit-tab-size",
    "--shedit-pad-x",
    "--shedit-pad-y",
    "--shedit-font-size",
    "--shedit-font-family",
  ]) {
    host.style.removeProperty(key);
  }
}

function editorShellMarkup() {
  return html`
    <div class="shedit">
      <div class="shedit__gutter" aria-hidden="true"></div>
      <div class="shedit__code">
        <pre class="shedit__mirror shedit__mirror-hl" aria-hidden="true"><code></code></pre>
        <pre class="shedit__mirror shedit__mirror-twoslash" aria-hidden="true"><code></code></pre>
        <div class="shedit__placeholder" aria-hidden="true"></div>
        <textarea
          class="shedit__textarea"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
        ></textarea>
      </div>
    </div>
  `;
}

function editorShellHtml(): string {
  const markup = editorShellMarkup() as { value: string };
  return markup.value;
}

function mountEditorShell(container: HTMLElement): HTMLElement {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.innerHTML = editorShellHtml();
  const host = wrap.firstElementChild as HTMLElement;
  if (!host) throw new Error("shedit: editor shell markup produced no element");
  container.appendChild(host);
  return host;
}

function syncScroll(view: EditorView): void {
  view.mirrorHl.scrollTop = view.textarea.scrollTop;
  view.mirrorHl.scrollLeft = view.textarea.scrollLeft;
  view.mirrorTwoslash?.scrollTo(view.textarea.scrollLeft, view.textarea.scrollTop);
  view.gutter.scrollTop = view.textarea.scrollTop;
}

function resolveThemeKeys(themes: Record<string, BundledTheme>): { light: string; dark: string } {
  return {
    light: "light" in themes ? "light" : (Object.keys(themes)[0] ?? "light"),
    dark: "dark" in themes ? "dark" : (Object.keys(themes)[1] ?? Object.keys(themes)[0] ?? "dark"),
  };
}

function mirrorLineText(text: string, lineIndex: number, lineCount: number): string {
  return lineIndex < lineCount - 1 ? text + "\n" : text;
}

// ─── 3. CSS Custom Highlight (live mirror) ────────────────────────────────────

function assertHighlightApi(): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) {
    throw new Error("shedit requires CSS Custom Highlight API (CSS.highlights)");
  }
}

function tokenColor(token: ThemedToken, themeKey: string): string | undefined {
  const style = token.htmlStyle;
  if (style && typeof style === "object") {
    const c = (style as Record<string, string>)[themeKey];
    if (c) return c;
  }
  return token.color;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function assertTokenLengths(line: LineHighlightInput): void {
  if (typeof import.meta !== "undefined" && !(import.meta as { env?: { DEV?: boolean } }).env?.DEV)
    return;
  const sum = line.tokens.reduce((n, t) => n + t.content.length, 0);
  if (line.tokens.length > 0 && sum !== line.text.length) {
    console.warn(
      `[shedit] token length mismatch on line ${line.lineIndex}: ${sum} vs ${line.text.length}`,
    );
  }
}

function createMirrorHighlightController(
  host: HTMLElement,
  mirror: HTMLElement,
  themeKeys: { light: string; dark: string },
  themeMode: SheditThemeMode,
): MirrorHighlightController {
  assertHighlightApi();

  const blockId = `shedit-${Math.random().toString(36).slice(2, 11)}`;
  let activeThemeKey = themeKeys.light;
  const highlightPrefix = `shedit-hl-${blockId}-`;
  let styleEl: HTMLStyleElement | null = null;
  let lastLines: LineHighlightInput[] = [];

  mirror.dataset.highlightBlock = blockId;

  function ensureCodeShell(): HTMLElement {
    let code = mirror.querySelector<HTMLElement>(":scope > code");
    if (!code) {
      mirror.replaceChildren();
      code = document.createElement("code");
      mirror.appendChild(code);
    }
    return code;
  }

  function lineTextEl(lineIndex: number): HTMLElement | null {
    return mirror.querySelector(`[data-line="${lineIndex}"] .shedit__line-text`);
  }

  function clearRegisteredHighlights(): void {
    for (const name of [...CSS.highlights.keys()]) {
      if (name.startsWith(highlightPrefix)) CSS.highlights.delete(name);
    }
  }

  function upsertStyleSheet(colorToName: Map<string, string>): void {
    const colorRules = [...colorToName.entries()]
      .map(([color, name]) => `::highlight(${name}) { color: ${color}; }`)
      .join("\n");

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.className = "shedit__highlight-style";
      styleEl.dataset.sheditHighlight = blockId;
      host.appendChild(styleEl);
    }
    styleEl.textContent = colorRules;
  }

  function applyHighlights(lines: LineHighlightInput[]): void {
    clearRegisteredHighlights();

    const colorToName = new Map<string, string>();
    let colorIndex = 0;
    const rangesByHighlight = new Map<string, Range[]>();
    for (const line of lines) {
      assertTokenLengths(line);
      const { lineIndex, tokens } = line;
      const content = lineTextEl(lineIndex);
      const textNode = content?.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

      let offset = 0;
      for (const token of tokens) {
        const color = tokenColor(token, activeThemeKey);
        const len = token.content.length;
        if (color && len > 0) {
          if (!colorToName.has(color)) {
            colorToName.set(color, `${highlightPrefix}${colorIndex++}`);
          }
          const highlightName = colorToName.get(color)!;
          if (!rangesByHighlight.has(highlightName)) rangesByHighlight.set(highlightName, []);

          const range = new Range();
          const textLen = textNode.nodeValue?.length ?? 0;
          const end = offset + len;
          if (end <= textLen) {
            range.setStart(textNode, offset);
            range.setEnd(textNode, end);
            rangesByHighlight.get(highlightName)!.push(range);
          }
        }
        offset += len;
      }
    }

    upsertStyleSheet(colorToName);

    for (const [name, ranges] of rangesByHighlight) {
      if (ranges.length > 0) {
        CSS.highlights.set(name, new Highlight(...ranges));
      }
    }
  }

  function renderPlainLines(lines: LineHighlightInput[]): void {
    const code = ensureCodeShell();
    const n = lines.length;
    code.innerHTML = lines
      .map(({ lineIndex, text }) => {
        const display = mirrorLineText(text, lineIndex, n);
        const escaped = escapeHtml(display);
        return `<span class="shedit__line" data-line="${lineIndex}"><span class="shedit__line-text">${escaped}</span></span>`;
      })
      .join("");
  }

  function setActiveThemeKey(): void {
    if (themeMode === "light") activeThemeKey = themeKeys.light;
    else if (themeMode === "dark") activeThemeKey = themeKeys.dark;
    else
      activeThemeKey = matchMedia("(prefers-color-scheme: dark)").matches
        ? themeKeys.dark
        : themeKeys.light;
  }

  const media = themeMode === "system" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const onScheme = () => {
    setActiveThemeKey();
    if (lastLines.length) applyHighlights(lastLines);
  };
  media?.addEventListener("change", onScheme);
  setActiveThemeKey();

  return {
    renderLines(lines: LineHighlightInput[]) {
      lastLines = lines;
      renderPlainLines(lines);
      applyHighlights(lines);
    },
    updateLineTexts(lines: LineHighlightInput[]) {
      const n = lastLines.length;
      for (const { lineIndex, text, tokens } of lines) {
        const el = lineTextEl(lineIndex);
        if (el) el.textContent = mirrorLineText(text, lineIndex, n);
        if (!lastLines[lineIndex]) {
          lastLines[lineIndex] = { lineIndex, text, tokens };
        } else {
          lastLines[lineIndex]!.text = text;
          lastLines[lineIndex]!.tokens = tokens;
        }
      }
      applyHighlights(lastLines);
    },
    reapplyHighlights() {
      if (lastLines.length) applyHighlights(lastLines);
    },
    dispose() {
      media?.removeEventListener("change", onScheme);
      clearRegisteredHighlights();
      styleEl?.remove();
      styleEl = null;
      lastLines = [];
    },
  };
}

function syncHostColorScheme(host: HTMLElement, mode: SheditThemeMode): () => void {
  const apply = () => {
    if (mode === "light") host.dataset.theme = "light";
    else if (mode === "dark") host.dataset.theme = "dark";
    else host.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  apply();
  if (mode !== "system") return () => {};
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}

// ─── 4. Document model ────────────────────────────────────────────────────────

const grammarHashCache = new WeakMap<object, string>();

function hashState(state: GrammarState | undefined): string {
  if (!state) return "";
  const cached = grammarHashCache.get(state);
  if (cached !== undefined) return cached;
  try {
    const scopes = state.getScopes();
    const hash = scopes ? JSON.stringify(scopes) : "";
    grammarHashCache.set(state, hash);
    return hash;
  } catch {
    return "";
  }
}

function diffLines(oldLines: LineRecord[], newLines: string[]): [number, number, number] {
  const oldLen = oldLines.length;
  const newLen = newLines.length;
  let start = 0;
  while (start < oldLen && start < newLen && oldLines[start]!.text === newLines[start]) start++;
  let oldEnd = oldLen;
  let newEnd = newLen;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1]!.text === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return [start, oldEnd, newEnd];
}

type EditorHistorySnap = { value: string; start: number; end: number };

const HISTORY_CAP = 200;
/** Merge consecutive typed characters into one undo step until idle or a word boundary. */
const TYPING_UNDO_IDLE_MS = 450;

const BRACKET_OPEN = new Set(["(", "[", "{"]);
const BRACKET_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const QUOTE_CHARS = new Set(['"', "'", "`"]);

// ─── 5–6. Editor controller ───────────────────────────────────────────────────

const DEFAULT_TWOSLASH_OPTS = {
  debounceMs: 400,
  peekHoverMs: 1000,
} as const;

function resolveTwoslash(
  input: ShikiEditorInput["twoslash"],
): TwoslashEditorOptions & { active: boolean } {
  if (input === false) {
    return {
      active: false,
      debounceMs: DEFAULT_TWOSLASH_OPTS.debounceMs,
      peekHoverMs: DEFAULT_TWOSLASH_OPTS.peekHoverMs,
    };
  }
  if (input === undefined || input === true) {
    return {
      active: true,
      debounceMs: DEFAULT_TWOSLASH_OPTS.debounceMs,
      peekHoverMs: DEFAULT_TWOSLASH_OPTS.peekHoverMs,
    };
  }
  const opts = input;
  return {
    active: opts.enabled !== false,
    debounceMs: opts.debounceMs ?? DEFAULT_TWOSLASH_OPTS.debounceMs,
    compilerOptions: opts.compilerOptions,
    virtualFiles: opts.virtualFiles,
    peekHoverMs: opts.peekHoverMs ?? DEFAULT_TWOSLASH_OPTS.peekHoverMs,
  };
}

function attachShikiEditor(host: HTMLElement, options: ShikiEditorInput): ShikiEditorHandle {
  const {
    shiki,
    lang,
    themes,
    theme: themeMode = "system",
    onChange: initialOnChange,
    ariaLabel,
    placeholder: placeholderText = "",
  } = options;
  let onChange = initialOnChange;

  const twoslashOpts = resolveTwoslash(options.twoslash);
  const useTwoslash = twoslashOpts.active && isTwoslashLanguage(lang);

  const layout = resolveLayout(options);
  let lines: LineRecord[] = [];
  let value = normalizeEditorDocument(options.value ?? "", useTwoslash);
  let currentLang = lang;
  let disposed = false;
  let scrollRaf = 0;
  let gutterSyncRaf = 0;
  let activeLine = -1;
  let gutterBuiltForLines = -1;

  let undoStack: EditorHistorySnap[] = [];
  let redoStack: EditorHistorySnap[] = [];
  let lastHistoryValue = value;
  let skipHistoryRecord = false;
  let typingBatchSnap: EditorHistorySnap | null = null;
  let typingIdleTimer = 0;

  const lifetime = new AbortController();
  let tokenizeAbort = new AbortController();

  host.classList.add(BLOCK);
  applyLayout(host, layout);
  const stopSchemeHost = syncHostColorScheme(host, themeMode);

  const mirrorHl = host.querySelector<HTMLPreElement>(`.${BLOCK}__mirror-hl`)!;
  const mirrorTwoslashEl = host.querySelector<HTMLPreElement>(`.${BLOCK}__mirror-twoslash`);

  const view: EditorView = {
    host,
    gutter: host.querySelector<HTMLDivElement>(`.${BLOCK}__gutter`)!,
    mirrorHl,
    mirrorTwoslash: null,
    textarea: host.querySelector<HTMLTextAreaElement>(`.${BLOCK}__textarea`)!,
  };

  if (ariaLabel) view.textarea.setAttribute("aria-label", ariaLabel);

  const placeholderEl = host.querySelector<HTMLDivElement>(`.${BLOCK}__placeholder`);
  function syncPlaceholder(): void {
    if (!placeholderEl) return;
    const show = placeholderText.length > 0 && view.textarea.value.length === 0;
    placeholderEl.classList.toggle(`${BLOCK}__placeholder--visible`, show);
    placeholderEl.textContent = show ? placeholderText : "";
  }

  let twoslashActive = useTwoslash;
  if (twoslashActive) {
    host.classList.add(`${BLOCK}--twoslash`);
    view.mirrorTwoslash = mirrorTwoslashEl;
  } else {
    mirrorTwoslashEl?.remove();
  }

  const highlight = createMirrorHighlightController(
    host,
    view.mirrorHl,
    resolveThemeKeys(themes),
    themeMode,
  );

  const twoslashUi = twoslashActive
    ? bindTwoslashUi(host, view.textarea, view.mirrorTwoslash, lifetime.signal, {
        peekHoverMs: twoslashOpts.peekHoverMs,
      })
    : null;
  let twoslashTimer = 0;
  let twoslashGen = 0;

  function disableTwoslashFallback(): void {
    if (!twoslashActive) return;
    twoslashActive = false;
    host.classList.remove(`${BLOCK}--twoslash`);
    twoslashUi?.dispose();
    view.mirrorTwoslash?.replaceChildren();
    view.mirrorTwoslash?.classList.remove(
      "twoslash",
      "lsp",
      "shiki",
      `${BLOCK}__mirror-twoslash--ready`,
    );
    scheduleTokenize(0);
  }

  function renderHighlightMirror(): void {
    highlight.renderLines(toHighlightLines());
    syncScroll(view);
    renderGutter();
  }

  const lineSel = `.${BLOCK}__gutter-line`;
  const lineActive = `${BLOCK}__gutter-line--active`;

  function toHighlightLines(): LineHighlightInput[] {
    return lines.map((line, lineIndex) => ({
      lineIndex,
      text: line.text,
      tokens: line.tokens,
    }));
  }

  function mirrorLineHeight(lineIndex: number): number {
    const el = view.mirrorHl.querySelector(`[data-line="${lineIndex}"]`) as HTMLElement | null;
    const lh = layout.lineHeight;
    if (!el) return lh;
    return Math.max(lh, el.getBoundingClientRect().height);
  }

  function visualRowsForLine(lineIndex: number): number {
    const lh = layout.lineHeight;
    return Math.max(1, Math.round(mirrorLineHeight(lineIndex) / lh));
  }

  function buildGutterRows(): void {
    const { gutter } = view;
    const count = lines.length || 1;
    const spans: HTMLSpanElement[] = [];

    for (let i = 0; i < count; i++) {
      const rows = visualRowsForLine(i);
      const blockH = mirrorLineHeight(i);
      for (let r = 0; r < rows; r++) {
        const span = document.createElement("span");
        span.className = `${BLOCK}__gutter-line`;
        if (r > 0) span.classList.add(`${BLOCK}__gutter-line--wrap`);
        span.dataset.line = String(i);
        span.textContent = r === 0 ? String(i + 1) : "";
        const rowH = r < rows - 1 ? layout.lineHeight : blockH - layout.lineHeight * (rows - 1);
        span.style.height = `${Math.max(layout.lineHeight, rowH)}px`;
        spans.push(span);
      }
    }

    gutter.replaceChildren(...spans);
    gutterBuiltForLines = count;
  }

  /** Caret line while typing; stored line when gutter not focused. */
  function gutterActiveLineIndex(): number {
    if (document.activeElement === view.textarea) return getCaretLine();
    return activeLine >= 0 ? activeLine : getCaretLine();
  }

  function applyGutterActiveState(): void {
    const idx = gutterActiveLineIndex();
    const count = lines.length || 1;
    const line = Math.max(0, Math.min(idx, count - 1));
    activeLine = line;
    clearGutterActive();
    view.gutter.querySelectorAll<HTMLElement>(`${lineSel}[data-line="${line}"]`).forEach((el) => {
      el.classList.add(lineActive);
    });
  }

  function syncGutterScroll(): void {
    view.gutter.scrollTop = view.textarea.scrollTop;
  }

  /** Rebuild gutter DOM only when line count changes; always refresh active + scroll. */
  function syncGutter({ rebuildHeights = false }: { rebuildHeights?: boolean } = {}): void {
    const count = lines.length || 1;
    if (count !== gutterBuiltForLines || rebuildHeights) {
      buildGutterRows();
    }
    applyGutterActiveState();
    syncGutterScroll();
  }

  function scheduleGutterSync(): void {
    if (gutterSyncRaf) return;
    gutterSyncRaf = requestAnimationFrame(() => {
      gutterSyncRaf = 0;
      syncGutter({ rebuildHeights: true });
    });
  }

  function renderGutter(): void {
    syncGutter({ rebuildHeights: true });
    scheduleGutterSync();
  }

  function getCaretLine(): number {
    const pos = view.textarea.selectionStart;
    const text = view.textarea.value;
    let n = 0;
    for (let i = 0; i < pos; i++) {
      if (text.charCodeAt(i) === 10) n++;
    }
    return n;
  }

  function clearGutterActive(): void {
    view.gutter.querySelectorAll(lineSel).forEach((el) => el.classList.remove(lineActive));
  }

  function setGutterActiveLine(lineIndex: number): void {
    activeLine = lineIndex;
    applyGutterActiveState();
  }

  function updateActiveLine(): void {
    applyGutterActiveState();
  }

  function selectLine(lineIndex: number): void {
    const count = lines.length || 1;
    if (lineIndex < 0 || lineIndex >= count) return;
    let start = 0;
    for (let i = 0; i < lineIndex; i++) start += lines[i]!.text.length + 1;
    const lineLen = lines[lineIndex]?.text.length ?? 0;
    view.textarea.focus();
    view.textarea.setSelectionRange(start, start + lineLen);
    setGutterActiveLine(lineIndex);
  }

  function onGutterClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>(lineSel);
    if (!target) return;
    selectLine(Number(target.dataset.line));
  }

  view.gutter.addEventListener("click", onGutterClick, { signal: lifetime.signal });

  const resizeObs = new ResizeObserver(() => scheduleGutterSync());
  resizeObs.observe(view.mirrorHl);
  if (view.mirrorTwoslash) resizeObs.observe(view.mirrorTwoslash);
  lifetime.signal.addEventListener("abort", () => resizeObs.disconnect());

  async function renderTwoslashOverlay(): Promise<void> {
    const overlay = view.mirrorTwoslash;
    if (!twoslashActive || !overlay) return;

    const gen = ++twoslashGen;
    const result = await renderTwoslashMirrorHtml(
      shiki,
      value,
      currentLang,
      themes,
      twoslashOpts.compilerOptions,
      twoslashOpts.virtualFiles,
    );
    if (gen !== twoslashGen || lifetime.signal.aborted) return;
    if (!result.ok) {
      disableTwoslashFallback();
      return;
    }
    applyTwoslashOverlayHtml(host, overlay, result.html);
    overlay.classList.add(`${BLOCK}__mirror-twoslash--ready`);
    twoslashUi?.clearPeek();
    syncScroll(view);
    scheduleGutterSync();
  }

  function scheduleTwoslashOverlay(): void {
    if (!twoslashActive) return;
    if (twoslashTimer) clearTimeout(twoslashTimer);
    twoslashTimer = window.setTimeout(() => {
      twoslashTimer = 0;
      void renderTwoslashOverlay();
    }, twoslashOpts.debounceMs);
  }

  function renderMirror(): void {
    renderHighlightMirror();
    if (twoslashActive) scheduleTwoslashOverlay();
  }

  function patchMirrorLines(start: number, end: number): boolean {
    const chunk: LineHighlightInput[] = [];
    for (let i = start; i < end; i++) {
      const line = lines[i];
      if (!line) return false;
      chunk.push({ lineIndex: i, text: line.text, tokens: line.tokens });
    }
    highlight.updateLineTexts(chunk);
    if (twoslashActive) scheduleTwoslashOverlay();
    return view.mirrorHl.querySelector(`[data-line="${start}"]`) !== null;
  }

  async function tokenizeFrom(startLine: number, signal: AbortSignal): Promise<void> {
    let changed = false;
    let batchStart = performance.now();
    const dirtyIndices: number[] = [];

    for (let i = startLine; i < lines.length; i++) {
      if (signal.aborted || lifetime.signal.aborted) return;
      const line = lines[i]!;
      const prevState = i > 0 ? lines[i - 1]?.grammarState : undefined;
      const prevHash = hashState(prevState);
      if (!line.dirty && line.grammarHash === prevHash) break;

      try {
        const result = shiki.codeToTokens(line.text, {
          lang: currentLang,
          themes,
          defaultColor: false,
          cssVariablePrefix: "",
          grammarState: prevState,
        });
        line.grammarState = result.grammarState;
        line.grammarHash = hashState(result.grammarState);
        line.tokens = result.tokens[0] ?? [];
      } catch {
        line.tokens = [];
      }
      line.dirty = false;
      changed = true;
      dirtyIndices.push(i);

      if (performance.now() - batchStart >= 8) {
        highlight.updateLineTexts(
          dirtyIndices.map((idx) => ({
            lineIndex: idx,
            text: lines[idx]!.text,
            tokens: lines[idx]!.tokens,
          })),
        );
        dirtyIndices.length = 0;
        await new Promise<void>((r) => setTimeout(r, 0));
        batchStart = performance.now();
      }
    }

    if (!signal.aborted && changed) {
      if (dirtyIndices.length) {
        highlight.updateLineTexts(
          dirtyIndices.map((idx) => ({
            lineIndex: idx,
            text: lines[idx]!.text,
            tokens: lines[idx]!.tokens,
          })),
        );
      } else {
        highlight.reapplyHighlights();
      }
      syncScroll(view);
      syncGutter();
      if (twoslashActive) scheduleTwoslashOverlay();
    }
  }

  function scheduleTokenize(fromLine: number): void {
    tokenizeAbort.abort();
    tokenizeAbort = new AbortController();
    void tokenizeFrom(fromLine, tokenizeAbort.signal);
  }

  function commitEdit(newValue: string): void {
    const newTexts = splitDocumentValue(newValue);
    const [start, oldEnd, newEnd] = diffLines(lines, newTexts);
    const replacements: LineRecord[] = [];
    for (let i = start; i < newEnd; i++) {
      replacements.push({
        text: newTexts[i]!,
        tokens: [],
        grammarState: undefined,
        grammarHash: "",
        dirty: true,
      });
    }
    lines.splice(start, oldEnd - start, ...replacements);
    value = newValue;

    const sameLineCount = newEnd - start === oldEnd - start;
    if (sameLineCount && view.mirrorHl.querySelector(`[data-line="${start}"]`)) {
      if (patchMirrorLines(start, newEnd)) {
        scheduleTokenize(start);
        syncGutter();
        return;
      }
    }

    renderMirror();
    scheduleTokenize(start);
    syncGutter();
  }

  function syncTextareaDocument(raw: string): string {
    const doc = normalizeEditorDocument(raw, twoslashActive);
    if (doc !== raw) {
      const start = view.textarea.selectionStart;
      const end = view.textarea.selectionEnd;
      const nextStart = mapCursorAfterStripAnnotationLines(raw, start);
      const nextEnd = mapCursorAfterStripAnnotationLines(raw, end);
      view.textarea.value = doc;
      view.textarea.setSelectionRange(nextStart, nextEnd);
    }
    return doc;
  }

  function clearTypingIdleTimer(): void {
    if (typingIdleTimer) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = 0;
    }
  }

  function flushTypingBatch(): void {
    clearTypingIdleTimer();
    if (skipHistoryRecord || !typingBatchSnap) {
      typingBatchSnap = null;
      return;
    }
    const cur = view.textarea.value;
    if (typingBatchSnap.value !== cur) {
      undoStack.push(typingBatchSnap);
      if (undoStack.length > HISTORY_CAP) undoStack.shift();
      redoStack.length = 0;
    }
    typingBatchSnap = null;
  }

  function scheduleTypingIdleFlush(): void {
    clearTypingIdleTimer();
    typingIdleTimer = window.setTimeout(() => {
      typingIdleTimer = 0;
      flushTypingBatch();
    }, TYPING_UNDO_IDLE_MS);
  }

  function beginTypingBatchIfNeeded(): void {
    if (skipHistoryRecord) return;
    if (!typingBatchSnap) {
      typingBatchSnap = {
        value: view.textarea.value,
        start: view.textarea.selectionStart,
        end: view.textarea.selectionEnd,
      };
    }
  }

  function recordUndoBeforeEdit(): void {
    if (skipHistoryRecord) return;
    flushTypingBatch();
    const v = view.textarea.value;
    undoStack.push({
      value: v,
      start: view.textarea.selectionStart,
      end: view.textarea.selectionEnd,
    });
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
    redoStack.length = 0;
  }

  function applyTextEdit(nextRaw: string, selStart: number, selEnd: number): void {
    recordUndoBeforeEdit();
    view.textarea.value = nextRaw;
    view.textarea.setSelectionRange(selStart, selEnd);
    const doc = syncTextareaDocument(nextRaw);
    commitEdit(doc);
    onChange?.(doc);
    lastHistoryValue = doc;
    updateActiveLine();
    syncGutter();
    syncPlaceholder();
  }

  function restoreHistorySnap(snap: EditorHistorySnap): void {
    skipHistoryRecord = true;
    view.textarea.value = snap.value;
    view.textarea.setSelectionRange(snap.start, snap.end);
    const doc = syncTextareaDocument(snap.value);
    commitEdit(doc);
    onChange?.(doc);
    lastHistoryValue = doc;
    skipHistoryRecord = false;
    updateActiveLine();
    syncGutter();
    syncPlaceholder();
  }

  function onUndo(): boolean {
    flushTypingBatch();
    if (!undoStack.length) return false;
    const cur: EditorHistorySnap = {
      value: view.textarea.value,
      start: view.textarea.selectionStart,
      end: view.textarea.selectionEnd,
    };
    const snap = undoStack.pop()!;
    redoStack.push(cur);
    restoreHistorySnap(snap);
    return true;
  }

  function onRedo(): boolean {
    flushTypingBatch();
    if (!redoStack.length) return false;
    const cur: EditorHistorySnap = {
      value: view.textarea.value,
      start: view.textarea.selectionStart,
      end: view.textarea.selectionEnd,
    };
    const snap = redoStack.pop()!;
    undoStack.push(cur);
    restoreHistorySnap(snap);
    return true;
  }

  function onBeforeInput(e: InputEvent): void {
    if (skipHistoryRecord) return;

    const t = e.inputType;
    const isInsert = t.startsWith("insert");
    const isDelete = t.startsWith("delete");

    if (isDelete) {
      flushTypingBatch();
      typingBatchSnap = {
        value: view.textarea.value,
        start: view.textarea.selectionStart,
        end: view.textarea.selectionEnd,
      };
      return;
    }

    if (!isInsert) {
      flushTypingBatch();
      return;
    }

    if (view.textarea.selectionStart !== view.textarea.selectionEnd) {
      flushTypingBatch();
    }

    const data = e.data ?? "";
    if (data.length > 1) {
      flushTypingBatch();
      typingBatchSnap = {
        value: view.textarea.value,
        start: view.textarea.selectionStart,
        end: view.textarea.selectionEnd,
      };
      return;
    }

    beginTypingBatchIfNeeded();
  }

  function onInput(e: Event): void {
    const inputEv = e as InputEvent;
    const doc = syncTextareaDocument(view.textarea.value);

    if (!skipHistoryRecord && typingBatchSnap) {
      const data = inputEv.data ?? "";
      const t = inputEv.inputType;
      if (t.startsWith("delete")) {
        flushTypingBatch();
      } else if (data.length > 1) {
        flushTypingBatch();
      } else if (isTypingUndoBoundary(data)) {
        flushTypingBatch();
      } else {
        scheduleTypingIdleFlush();
      }
    }

    commitEdit(doc);
    onChange?.(doc);
    lastHistoryValue = doc;
    syncGutter();
    syncPlaceholder();
  }

  function onKeydown(e: KeyboardEvent): void {
    const { textarea } = view;
    const { tabSize } = layout;
    const mod = e.metaKey || e.ctrlKey;
    const alt = e.altKey;

    if (mod && e.key === "z" && !e.shiftKey) {
      if (onUndo()) e.preventDefault();
      return;
    }
    if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      if (onRedo()) e.preventDefault();
      return;
    }

    if (mod && e.key === "/" && !e.shiftKey && !alt) {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const { value: next, start: s, end: en } = toggleLineComments(textarea.value, start, end);
      applyTextEdit(next, s, en);
      return;
    }

    if (mod && e.key === "d" && !e.shiftKey && !alt) {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const { value: next, start: s, end: en } = duplicateLines(textarea.value, start, end);
      applyTextEdit(next, s, en);
      return;
    }

    if (mod && e.key === "x" && !e.shiftKey && !alt) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start === end) {
        e.preventDefault();
        const { value: next, start: s, end: en, cutText } = cutWholeLine(textarea.value, start);
        void navigator.clipboard.writeText(cutText).catch(() => {});
        applyTextEdit(next, s, en);
        return;
      }
    }

    if (!mod && !alt && e.key === "Backspace") {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start === end && start > 0) {
        const raw = textarea.value;
        const open = raw[start - 1];
        const close = raw[start];
        const pairedBracket =
          open && close && BRACKET_OPEN.has(open) && BRACKET_CLOSE[open] === close;
        const pairedQuote = open && close && open === close && QUOTE_CHARS.has(open);
        if (pairedBracket || pairedQuote) {
          e.preventDefault();
          const next = raw.slice(0, start - 1) + raw.slice(start + 1);
          applyTextEdit(next, start - 1, start - 1);
          return;
        }
      }
    }

    if (!mod && !alt && e.key.length === 1) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start !== end) {
        /* fall through */
      } else {
        const raw = textarea.value;
        const ch = e.key;

        if (BRACKET_OPEN.has(ch)) {
          e.preventDefault();
          const close = BRACKET_CLOSE[ch]!;
          const next = raw.slice(0, start) + ch + close + raw.slice(end);
          applyTextEdit(next, start + 1, start + 1);
          return;
        }

        if (QUOTE_CHARS.has(ch) && shouldAutoPairQuote(raw, start)) {
          e.preventDefault();
          const next = raw.slice(0, start) + ch + ch + raw.slice(end);
          applyTextEdit(next, start + 1, start + 1);
          return;
        }

        if (ch in BRACKET_CLOSE || QUOTE_CHARS.has(ch)) {
          const at = raw[start];
          if (at === ch) {
            e.preventDefault();
            textarea.setSelectionRange(start + 1, start + 1);
            return;
          }
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !mod) {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      const lineStart = before.lastIndexOf("\n") + 1;
      const indent = before.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "";
      const inserted = "\n" + indent;
      const next = before + inserted + after;
      applyTextEdit(next, start + inserted.length, start + inserted.length);
      return;
    }

    if (e.key !== "Tab") return;
    e.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const raw = textarea.value;

    if (e.shiftKey) {
      const { value: next, start: s, end: en } = outdentLineBlock(raw, start, end, tabSize);
      applyTextEdit(next, s, en);
    } else {
      const { value: next, start: s, end: en } = indentLineBlock(raw, start, end, tabSize);
      applyTextEdit(next, s, en);
    }
  }

  function onScroll(): void {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      syncScroll(view);
    });
  }

  function onSelectionChange(): void {
    if (document.activeElement !== view.textarea) return;
    updateActiveLine();
  }

  view.textarea.addEventListener("beforeinput", onBeforeInput, { signal: lifetime.signal });
  view.textarea.addEventListener("input", onInput, { signal: lifetime.signal });
  view.textarea.addEventListener("keydown", onKeydown, { signal: lifetime.signal });
  view.textarea.addEventListener("scroll", onScroll, { passive: true, signal: lifetime.signal });
  document.addEventListener("selectionchange", onSelectionChange, { signal: lifetime.signal });

  function setValue(newValue: string): void {
    const doc = normalizeEditorDocument(newValue, twoslashActive);
    view.textarea.value = doc;
    commitEdit(doc);
    undoStack.length = 0;
    redoStack.length = 0;
    lastHistoryValue = doc;
    typingBatchSnap = null;
    clearTypingIdleTimer();
    syncPlaceholder();
  }

  function getValue(): string {
    return value;
  }

  function setLang(newLang: BundledLanguage): void {
    if (newLang === currentLang) return;
    currentLang = newLang;
    for (const line of lines) {
      line.dirty = true;
      line.grammarState = undefined;
      line.grammarHash = "";
    }
    scheduleTokenize(0);
    if (twoslashActive) scheduleTwoslashOverlay();
  }

  function getLang(): BundledLanguage {
    return currentLang;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    tokenizeAbort.abort();
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    if (gutterSyncRaf) cancelAnimationFrame(gutterSyncRaf);
    clearTypingIdleTimer();
    if (twoslashTimer) clearTimeout(twoslashTimer);
    twoslashUi?.dispose();
    highlight.dispose();
    stopSchemeHost();
    host.classList.remove(BLOCK);
    delete host.dataset.theme;
    clearLayout(host);
  }

  setValue(value);
  renderHighlightMirror();
  if (twoslashActive) void renderTwoslashOverlay();

  function setOnChange(callback: ((value: string) => void) | undefined): void {
    onChange = callback;
  }

  return { setValue, getValue, setLang, getLang, setOnChange, dispose };
}

/** Imperative factory (same engine as the {@link Editor} island). */
export function createShikiEditor(
  container: HTMLElement,
  options: ShikiEditorInput,
): ShikiEditorHandle {
  const host = mountEditorShell(container);
  return attachShikiEditor(host, options);
}

// ─── 7. Ilha island ───────────────────────────────────────────────────────────

const EDITOR_CSS = `
  .shedit {
    --shedit-bg: #ffffff;
    --shedit-fg: #1e1e1e;
    --shedit-gutter-bg: #f5f5f5;
    --shedit-gutter-fg: #999999;
    --shedit-gutter-fg-hover: #333333;
    --shedit-gutter-bg-hover: #e8e8e8;
    --shedit-border: #e0e0e0;
    --shedit-caret: #1e1e1e;
    position: relative;
    display: flex;
    overflow: hidden;
    width: 100%;
    height: 100%;
    flex: 1 1 auto;
    font-family: var(--shedit-font-family, ui-monospace, monospace);
    font-size: var(--shedit-font-size, 14px);
    line-height: var(--shedit-line-height, 22px);
    background: var(--shedit-bg);
    color: var(--shedit-fg);
  }

  .shedit[data-theme="dark"] {
    --shedit-bg: #1e1e1e;
    --shedit-fg: #d4d4d4;
    --shedit-gutter-bg: #252526;
    --shedit-gutter-fg: #5a5a5a;
    --shedit-gutter-fg-hover: #cccccc;
    --shedit-gutter-bg-hover: #2d2d2d;
    --shedit-border: #3c3c3c;
    --shedit-caret: #d4d4d4;
  }

  .shedit__highlight-style {
    display: none;
  }

  .shedit__gutter {
    flex: 0 0 auto;
    min-width: 3.5em;
    padding: var(--shedit-pad-y, 16px) 0;
    text-align: right;
    user-select: none;
    pointer-events: none;
    background: var(--shedit-gutter-bg);
    border-right: 1px solid var(--shedit-border);
    z-index: 2;
    overflow: hidden;
  }

  .shedit__gutter-line {
    display: block;
    padding: 0 10px 0 6px;
    font: inherit;
    line-height: var(--shedit-line-height, 22px);
    min-height: var(--shedit-line-height, 22px);
    box-sizing: border-box;
    color: var(--shedit-gutter-fg);
    cursor: pointer;
    pointer-events: all;
    transition: color 0.1s, background 0.1s;
  }

  .shedit__gutter-line:hover,
  .shedit__gutter-line--active {
    color: var(--shedit-gutter-fg-hover);
    background: var(--shedit-gutter-bg-hover);
  }

  .shedit__gutter-line--wrap {
    cursor: default;
    pointer-events: none;
  }

  .shedit__code {
    position: relative;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .shedit__placeholder {
    position: absolute;
    inset: 0;
    padding: var(--shedit-pad-y, 16px) var(--shedit-pad-x, 16px);
    pointer-events: none;
    user-select: none;
    white-space: pre-wrap;
    color: var(--shedit-placeholder-fg, #a0a0a0);
    opacity: 0;
    overflow: hidden;
    font: inherit;
    font-size: inherit;
    line-height: var(--shedit-line-height, 22px);
    box-sizing: border-box;
  }

  .shedit__placeholder--visible {
    opacity: 1;
  }

  .shedit[data-theme="dark"] .shedit__placeholder {
    --shedit-placeholder-fg: #6a6a6a;
  }

  .shedit__mirror,
  .shedit__textarea {
    margin: 0;
    padding: var(--shedit-pad-y, 16px) var(--shedit-pad-x, 16px);
    border: 0;
    font: inherit;
    font-size: inherit;
    line-height: var(--shedit-line-height, 22px);
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    box-sizing: border-box;
    tab-size: var(--shedit-tab-size, 2);
  }

  .shedit__mirror {
    position: absolute;
    inset: 0;
    pointer-events: none;
    user-select: none;
    overflow: auto;
    contain: strict;
    background: transparent;
    color: inherit;
    scrollbar-width: none;
  }

  .shedit__mirror-hl {
    z-index: 0;
  }

  .shedit__mirror-twoslash {
    z-index: 1;
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .shedit__mirror-twoslash--ready {
    opacity: 1;
  }

  /* Twoslash hovers on overlay; textarea on top for typing */
  .shedit--twoslash.shedit--twoslash-held .shedit__textarea {
    pointer-events: none;
  }

  .shedit--twoslash.shedit--twoslash-held .shedit__mirror-twoslash {
    pointer-events: auto;
  }

  .shedit__mirror::-webkit-scrollbar {
    display: none;
  }

  .shedit__mirror > code {
    display: block;
    margin: 0;
    padding: 0;
    font: inherit;
    font-size: inherit;
    line-height: var(--shedit-line-height, 22px);
  }

  .shedit__line {
    display: block;
    margin: 0;
    padding: 0;
    line-height: var(--shedit-line-height, 22px);
    min-height: var(--shedit-line-height, 22px);
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  .shedit__line-text {
    display: inline;
  }

  .shedit__textarea {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    resize: none;
    outline: none;
    background: transparent;
    color: transparent;
    caret-color: var(--shedit-caret);
    z-index: 1;
    overflow: auto;
  }

  .shedit--twoslash .shedit__mirror-twoslash .twoslash-popup-container {
    opacity: 0 !important;
    pointer-events: none !important;
    transition: opacity 0.15s ease;
  }

  /* ~1s dwell without modifier */
  .shedit--twoslash.shedit--twoslash-peek .shedit__mirror-twoslash .shedit__twoslash-peek-active .twoslash-popup-container {
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  .shedit--twoslash.shedit--twoslash-peek .shedit__mirror-twoslash .shedit__twoslash-peek-active {
    border-bottom-color: var(--twoslash-underline-color, currentColor);
  }

  /* Ctrl/Cmd + hover */
  .shedit--twoslash.shedit--twoslash-held .shedit__mirror-twoslash .twoslash-hover:hover .twoslash-popup-container,
  .shedit--twoslash.shedit--twoslash-held .shedit__mirror-twoslash .twoslash-error-hover:hover .twoslash-popup-container,
  .shedit--twoslash.shedit--twoslash-held .shedit__mirror-twoslash .twoslash-query-persisted:hover .twoslash-popup-container,
  .shedit--twoslash.shedit--twoslash-held .shedit__mirror-twoslash .twoslash-query-line:hover .twoslash-popup-container {
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  .shedit--twoslash.shedit--twoslash-held .shedit__mirror-twoslash .twoslash-completion-cursor .twoslash-completion-list {
    display: inline-block;
  }

  .shedit--twoslash .shedit__mirror-twoslash .twoslash-completion-cursor .twoslash-completion-list {
    display: none;
  }

  .shedit[data-theme="dark"].shedit--twoslash .shedit__mirror-twoslash {
    --twoslash-popup-bg: #222222;
  }
`;

export const Editor = ilha
  .input<ShikiEditorInput & Record<string, unknown>>()
  .css(EDITOR_CSS)
  .onMount(({ host, input }) => {
    const root = host.querySelector<HTMLElement>(`.${BLOCK}`)!;
    const handle = attachShikiEditor(root, input);
    (root as HTMLElement & { shedit?: ShikiEditorHandle }).shedit = handle;
    return () => {
      handle.dispose();
      delete (root as HTMLElement & { shedit?: ShikiEditorHandle }).shedit;
    };
  })
  .render(() => editorShellMarkup());
