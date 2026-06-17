import { codeToHtml } from "shiki";
import type { BundledLanguage, BundledTheme, HighlighterCore, ShikiTransformer } from "shiki";
import { createTransformerFactory, rendererRich } from "@shikijs/twoslash/core";
import { createTwoslashFromCDN, type TwoslashCdnReturn } from "twoslash-cdn";

export type TwoslashEditorOptions = {
  enabled?: boolean;
  debounceMs?: number;
  /** Show type popup after hovering a twoslash span this long (ms). `false` = only with Ctrl/Cmd. Default 1000. */
  peekHoverMs?: number | false;
  compilerOptions?: Record<string, unknown>;
  /**
   * Pre-seed Twoslash VFS (`/node_modules/...` paths). Usually unnecessary: ATA + esm.sh fetcher
   * pulls typings from npm. Use for unpublished packages or when CDN resolution is wrong.
   */
  virtualFiles?: Record<string, string>;
};

const TWOSLASH_HOVER_SELECTOR = ".twoslash-hover, .twoslash-error-hover, .twoslash-query-persisted";

const TWOSLASH_LANGS = new Set(["typescript", "ts", "tsx", "javascript", "js"]);

/** Twoslash handbook markers (`// ^?`, `// ^|`, `// ^^^`) — not part of editable source. */
export const TWOSLASH_ANNOTATION_LINE_RE = /^\s*\/\/\s*\^(\?|\||\^+)/;

export function stripTwoslashAnnotationLines(source: string): string {
  if (!source) return source;
  const lines = source.split("\n");
  const kept = lines.filter((line) => !TWOSLASH_ANNOTATION_LINE_RE.test(line));
  if (kept.length === 0) return "";
  return kept.join("\n");
}

/** Map a cursor index in `before` to the same logical position in `stripTwoslashAnnotationLines(before)`. */
export function mapCursorAfterStripAnnotationLines(before: string, cursor: number): number {
  const lines = before.split("\n");
  let raw = 0;
  let mapped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineLen = line.length;
    const rawLineEnd = raw + lineLen;
    const drop = TWOSLASH_ANNOTATION_LINE_RE.test(line);

    if (cursor < raw) return mapped;
    if (cursor <= rawLineEnd) {
      return drop ? mapped : mapped + (cursor - raw);
    }

    raw = rawLineEnd + (i < lines.length - 1 ? 1 : 0);
    if (!drop) mapped += lineLen + (i < lines.length - 1 ? 1 : 0);
  }
  return mapped;
}

export function normalizeEditorDocument(source: string, twoslash: boolean): string {
  return twoslash ? stripTwoslashAnnotationLines(source) : source;
}

/** Numeric `target` — twoslash-cdn breaks on string targets and defaults to ES5 (extra CDN libs). */
const DEFAULT_COMPILER_OPTIONS: Record<string, unknown> = {
  target: 7,
  lib: ["dom", "es2020"],
  skipLibCheck: true,
};

const ESM_TYPESCRIPT_VERSION = "5.7.3";
const ESM_TYPESCRIPT_LIB = `https://esm.sh/typescript@${ESM_TYPESCRIPT_VERSION}/lib/`;

/** Legacy names in twoslash-cdn’s list that are not shipped in the npm `typescript` package. */
const TYPESCRIPT_LIB_STUB_FILES = new Set([
  "lib.core.d.ts",
  "lib.core.es6.d.ts",
  "lib.core.es7.d.ts",
  "lib.es7.d.ts",
]);

const STUB_LIB_DTS = "export {};\n";

function stubLibResponse(): Response {
  return new Response(STUB_LIB_DTS, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

let cdnInstance: TwoslashCdnReturn | null = null;
let cdnInit: Promise<TwoslashCdnReturn> | null = null;
let twoslashTransformer: ShikiTransformer | null = null;
let cdnVirtualSeedKey = "";
let activeTwoslashFsMap: Map<string, string> | null = null;

const TWOSLASH_HANDBOOK = {
  noErrors: true,
  noErrorValidation: true,
} as const;

function mergeTwoslashCompilerOptions(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...DEFAULT_COMPILER_OPTIONS,
    moduleResolution: 100,
    baseUrl: "/",
    ...overrides,
  };
}

function reapplySeededVfsToMap(): void {
  if (!activeTwoslashFsMap || seededVfsFiles.size === 0) return;
  for (const [path, content] of seededVfsFiles) {
    activeTwoslashFsMap.set(path, content);
  }
}

function vfsSeedKey(files?: Record<string, string>): string {
  if (!files || Object.keys(files).length === 0) return "";
  return String(Object.keys(files).sort().join("\0").length) + ":" + Object.keys(files).length;
}

function resetTwoslashCdn(): void {
  cdnInstance = null;
  cdnInit = null;
  twoslashTransformer = null;
  cdnVirtualSeedKey = "";
  activeTwoslashFsMap = null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function typescriptLibBasename(url: string): string | null {
  const marker = "/typescript/lib/";
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return url.slice(i + marker.length).split("?")[0] ?? null;
}

/** `cdn.jsdelivr.net/npm/pkg@ver/path` → `esm.sh/pkg@ver/path` (incl. scoped packages). */
function jsdelivrNpmFileToEsm(url: string): string | null {
  const prefix = "cdn.jsdelivr.net/npm/";
  const i = url.indexOf(prefix);
  if (i === -1) return null;
  const rest = url.slice(i + prefix.length);
  const lastAt = rest.lastIndexOf("@");
  if (lastAt <= 0) return null;
  const pkg = rest.slice(0, lastAt);
  const afterAt = rest.slice(lastAt + 1);
  const slash = afterAt.indexOf("/");
  const ver = (slash === -1 ? afterAt : afterAt.slice(0, slash)).split("?")[0]!;
  const path = slash === -1 ? "" : afterAt.slice(slash);
  return `https://esm.sh/${pkg}@${ver}${path}`;
}

function rewriteToEsmSh(input: RequestInfo | URL): RequestInfo | URL {
  const url = requestUrl(input);

  const libBase = typescriptLibBasename(url);
  if (libBase) {
    return ESM_TYPESCRIPT_LIB + libBase;
  }

  const esmNpm = jsdelivrNpmFileToEsm(url);
  if (esmNpm) return esmNpm;

  return input;
}

/** Seeded `/node_modules/...` bodies served by custom fetch (esm.sh for the rest). */
let seededVfsFiles = new Map<string, string>();

function vfsPathFromNpmFetchUrl(url: string): string | null {
  const esm = jsdelivrNpmFileToEsm(url);
  const resolved = esm ?? url;
  try {
    const path = new URL(resolved, "https://esm.sh").pathname;
    const marker = "/node_modules/";
    const idx = path.indexOf(marker);
    if (idx === -1) return null;
    return path.slice(idx).split("?")[0] ?? null;
  } catch {
    return null;
  }
}

function esmCdnFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const libBase = typescriptLibBasename(url);
  if (libBase && TYPESCRIPT_LIB_STUB_FILES.has(libBase)) {
    return Promise.resolve(stubLibResponse());
  }

  const vfsPath = vfsPathFromNpmFetchUrl(url);
  if (vfsPath && seededVfsFiles.has(vfsPath)) {
    return Promise.resolve(
      new Response(seededVfsFiles.get(vfsPath)!, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
  }

  const target = rewriteToEsmSh(input);
  return fetch(target, init).then((res) => {
    if (res.ok) return res;
    if (libBase?.endsWith(".d.ts")) return stubLibResponse();
    return res;
  });
}

function seedVirtualFs(map: Map<string, string>, files?: Record<string, string>): void {
  seededVfsFiles = new Map();
  if (!files) return;
  for (const [path, content] of Object.entries(files)) {
    const key = path.startsWith("/") ? path : `/${path}`;
    map.set(key, content);
    if (key.includes("/node_modules/")) {
      seededVfsFiles.set(key, content);
    }
  }
}

async function getTwoslashCdn(
  compilerOptions?: Record<string, unknown>,
  virtualFiles?: Record<string, string>,
): Promise<TwoslashCdnReturn> {
  const seedKey = vfsSeedKey(virtualFiles);
  if (cdnInstance && cdnVirtualSeedKey === seedKey) return cdnInstance;
  if (cdnInstance && seedKey && cdnVirtualSeedKey !== seedKey) {
    resetTwoslashCdn();
  }

  if (!cdnInit) {
    cdnInit = (async () => {
      const fsMap = new Map<string, string>();
      seedVirtualFs(fsMap, virtualFiles);
      activeTwoslashFsMap = fsMap;
      cdnVirtualSeedKey = seedKey;

      const mergedCompiler = mergeTwoslashCompilerOptions(compilerOptions);

      const twoslash = createTwoslashFromCDN({
        fetcher: esmCdnFetch as typeof fetch,
        fsMap,
        compilerOptions: mergedCompiler as never,
        twoSlashOptionsOverrides: {
          handbookOptions: { ...TWOSLASH_HANDBOOK },
          compilerOptions: mergedCompiler as never,
        },
      });
      await twoslash.init();
      reapplySeededVfsToMap();
      cdnInstance = twoslash;
      twoslashTransformer = createTransformerFactory(twoslash.runSync)({
        renderer: rendererRich(),
        explicitTrigger: false,
        throws: false,
        twoslashOptions: {
          handbookOptions: { ...TWOSLASH_HANDBOOK },
          compilerOptions: mergedCompiler as never,
        },
      });
      return twoslash;
    })().catch((err) => {
      resetTwoslashCdn();
      throw err;
    });
  }
  return cdnInit;
}

function shikiLang(lang: BundledLanguage): BundledLanguage {
  if (lang === "typescript") return "ts";
  return lang;
}

export function isTwoslashLanguage(lang: BundledLanguage | string): boolean {
  return TWOSLASH_LANGS.has(lang);
}

const SHIKI_STYLE_CLASS = "shedit__shiki-theme-style";

function makeOverlayTextTransparent(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el) continue;
    if (el.closest(".twoslash-popup-container, .twoslash-completion-list")) continue;
    if (el.closest(".twoslash-tag, .twoslash-error, .twoslash-tag-line")) continue;
    el.style.color = "transparent";
  }
}

/** Twoslash-only overlay: hovers/errors on top of the CSS-highlight base layer. */
export function applyTwoslashOverlayHtml(
  host: HTMLElement,
  overlay: HTMLPreElement,
  fullHtml: string,
): void {
  const doc = new DOMParser().parseFromString(fullHtml, "text/html");

  let styleEl = host.querySelector<HTMLStyleElement>(`.${SHIKI_STYLE_CLASS}`);
  const shikiStyle = doc.querySelector("style");
  if (shikiStyle?.textContent) {
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.className = SHIKI_STYLE_CLASS;
      host.appendChild(styleEl);
    }
    styleEl.textContent = shikiStyle.textContent;
  }

  const shikiPre = doc.querySelector("pre");
  const srcCode = shikiPre?.querySelector("code");
  const destCode = overlay.querySelector("code");
  if (!destCode || !srcCode) {
    if (destCode) destCode.textContent = "";
    overlay.classList.remove("shedit__mirror-twoslash--ready");
    return;
  }

  overlay.className = "shedit__mirror shedit__mirror-twoslash twoslash lsp shiki";
  if (shikiPre) {
    for (const cls of shikiPre.classList) {
      if (cls !== "twoslash" && cls !== "lsp") overlay.classList.add(cls);
    }
  }

  destCode.replaceChildren(...[...srcCode.childNodes].map((n) => n.cloneNode(true)));
  makeOverlayTextTransparent(destCode);
}

export type TwoslashRenderResult = { ok: true; html: string } | { ok: false; error: unknown };

export async function renderTwoslashMirrorHtml(
  _highlighter: HighlighterCore,
  code: string,
  lang: BundledLanguage,
  themes: Record<string, BundledTheme>,
  compilerOptions?: Record<string, unknown>,
  virtualFiles?: Record<string, string>,
): Promise<TwoslashRenderResult> {
  const shikiLangId = shikiLang(lang);

  const colorOpts = {
    themes,
    defaultColor: "light-dark()" as const,
  };

  if (code.length === 0) {
    return { ok: true, html: await codeToHtml("", { lang: shikiLangId, ...colorOpts }) };
  }

  try {
    const cdn = await getTwoslashCdn(compilerOptions, virtualFiles);
    const transformer = twoslashTransformer;
    if (!transformer) throw new Error("twoslash transformer not initialized");

    await cdn.prepareTypes(code);
    reapplySeededVfsToMap();

    const html = await codeToHtml(code, {
      lang: shikiLangId,
      ...colorOpts,
      transformers: [transformer],
    });

    return { ok: true, html };
  } catch (error) {
    console.warn("[shedit] twoslash overlay failed — syntax highlight still active", error);
    return { ok: false, error };
  }
}

export type TwoslashUiController = {
  setHeld(active: boolean): void;
  /** Drop dwell peek (e.g. after twoslash overlay DOM refresh). */
  clearPeek(): void;
  dispose(): void;
};

export type TwoslashUiOptions = {
  peekHoverMs?: number | false;
};

function clearTwoslashPeek(host: HTMLElement, active: HTMLElement | null): void {
  host.classList.remove("shedit--twoslash-peek");
  active?.classList.remove("shedit__twoslash-peek-active");
}

export function bindTwoslashUi(
  host: HTMLElement,
  textarea: HTMLTextAreaElement,
  mirrorTwoslash: HTMLPreElement | null,
  signal: AbortSignal,
  options: TwoslashUiOptions = {},
): TwoslashUiController {
  const heldClass = "shedit--twoslash-held";
  const peekMs = options.peekHoverMs === false ? 0 : (options.peekHoverMs ?? 1000);

  let peekTarget: HTMLElement | null = null;
  let peekTimer = 0;

  const setHeld = (active: boolean) => {
    host.classList.toggle(heldClass, active);
    if (active) {
      if (peekTimer) clearTimeout(peekTimer);
      peekTimer = 0;
      clearTwoslashPeek(host, peekTarget);
      peekTarget = null;
    }
  };

  const cancelPeek = () => {
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = 0;
    clearTwoslashPeek(host, peekTarget);
    peekTarget = null;
  };

  const twoslashSpanUnderPointer = (clientX: number, clientY: number): HTMLElement | null => {
    if (!mirrorTwoslash?.classList.contains("shedit__mirror-twoslash--ready")) return null;
    const prevTa = textarea.style.pointerEvents;
    const prevMirror = mirrorTwoslash.style.pointerEvents;
    textarea.style.pointerEvents = "none";
    mirrorTwoslash.style.pointerEvents = "auto";
    const el = document.elementFromPoint(clientX, clientY);
    textarea.style.pointerEvents = prevTa;
    mirrorTwoslash.style.pointerEvents = prevMirror;
    return el?.closest<HTMLElement>(TWOSLASH_HOVER_SELECTOR) ?? null;
  };

  const schedulePeek = (span: HTMLElement) => {
    if (peekMs <= 0 || host.classList.contains(heldClass)) return;
    if (peekTarget === span && host.classList.contains("shedit--twoslash-peek")) return;
    if (peekTimer) clearTimeout(peekTimer);
    clearTwoslashPeek(host, peekTarget);
    peekTarget = span;
    peekTimer = window.setTimeout(() => {
      peekTimer = 0;
      if (host.classList.contains(heldClass)) return;
      host.classList.add("shedit--twoslash-peek");
      span.classList.add("shedit__twoslash-peek-active");
    }, peekMs);
  };

  const onTextareaMove = (e: MouseEvent) => {
    if (host.classList.contains(heldClass)) return;
    const span = twoslashSpanUnderPointer(e.clientX, e.clientY);
    if (!span) {
      cancelPeek();
      return;
    }
    if (span !== peekTarget) schedulePeek(span);
  };

  const onTextareaLeave = () => cancelPeek();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Control" || e.key === "Meta") setHeld(true);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Control" || e.key === "Meta") setHeld(false);
  };

  const onBlur = () => {
    setHeld(false);
    cancelPeek();
  };

  textarea.addEventListener("mousemove", onTextareaMove, { signal });
  textarea.addEventListener("mouseleave", onTextareaLeave, { signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  window.addEventListener("keyup", onKeyUp, { signal });
  window.addEventListener("blur", onBlur, { signal });

  return {
    setHeld,
    clearPeek: cancelPeek,
    dispose() {
      setHeld(false);
      cancelPeek();
    },
  };
}

/** @deprecated Use bindTwoslashUi */
export function bindTwoslashHeldKey(host: HTMLElement, signal: AbortSignal): TwoslashUiController {
  const textarea = host.querySelector<HTMLTextAreaElement>(".shedit__textarea");
  const mirror = host.querySelector<HTMLPreElement>(".shedit__mirror-twoslash");
  if (!textarea) {
    return { setHeld: () => {}, clearPeek: () => {}, dispose: () => {} };
  }
  return bindTwoslashUi(host, textarea, mirror, signal, { peekHoverMs: false });
}
