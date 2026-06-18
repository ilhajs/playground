import type { TwoslashEditorOptions } from "shedit";
import { PREVIEW_IMPORT_MAP, PREVIEW_TRANSFORM_URL } from "./preview-cdn.ts";

// ─── URL / settings ───────────────────────────────────────────────────────────

export type PlaygroundMode = "editor" | "preview";
export type PlaygroundLayout = "horizontal" | "vertical";

export type PlaygroundSettings = {
  mode: PlaygroundMode;
  layout: PlaygroundLayout;
  code: string;
  style: string;
};

export const DEFAULT_PLAYGROUND_CODE = `import ilha from "ilha";

export default ilha.render(() => <p>Hello, World!</p>)
`;

export const PREVIEW_TOASTER_BOOTSTRAP = `import ilha from "ilha";
import { Toaster } from "areia";

const __previewToasterIsland = ilha
  .input()
  .render(() => (
    <Toaster position="bottom-right" closeButton richColors theme="system" />
  ));
export default __previewToasterIsland;
`;

function decodeBase64Utf8(raw: string): string {
  let b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  b64 += "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function decodeUrlParam(raw: string | null, fallback: string): string {
  if (!raw?.length) return fallback;
  try {
    return decodeBase64Utf8(raw);
  } catch {
    return fallback;
  }
}

export function encodeBase64UrlParam(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parsePlaygroundSettings(search: string | URLSearchParams): PlaygroundSettings {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const codeParam = params.get("code");
  const code =
    codeParam === null || codeParam === ""
      ? DEFAULT_PLAYGROUND_CODE
      : decodeUrlParam(codeParam, DEFAULT_PLAYGROUND_CODE);
  return {
    mode: params.get("mode") === "preview" ? "preview" : "editor",
    layout: params.get("layout") === "vertical" ? "vertical" : "horizontal",
    code,
    style: decodeUrlParam(params.get("style"), ""),
  };
}

function assignSearchFromUrl(url: URL): void {
  window.location.assign(url.pathname + url.search + url.hash);
}

export function navigateWithLayout(layout: PlaygroundLayout): void {
  const url = new URL(window.location.href);
  if (layout === "horizontal") url.searchParams.delete("layout");
  else url.searchParams.set("layout", layout);
  assignSearchFromUrl(url);
}

export function navigateWithMode(mode: PlaygroundMode): void {
  const url = new URL(window.location.href);
  if (mode === "editor") url.searchParams.delete("mode");
  else url.searchParams.set("mode", mode);
  assignSearchFromUrl(url);
}

export function syncCodeSearchParam(code: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("code", encodeBase64UrlParam(code));
  const next = url.pathname + url.search + url.hash;
  const current = location.pathname + location.search + location.hash;
  if (next !== current) history.replaceState(history.state, "", next);
}

let urlSyncTimer: ReturnType<typeof setTimeout> | undefined;
let urlSyncLastCode = "";

/** Debounced `?code=` sync for editor typing (call from `onChange`). */
export function scheduleCodeSearchParamSync(code: string, debounceMs = 400): void {
  urlSyncLastCode = code;
  if (urlSyncTimer !== undefined) clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(() => {
    urlSyncTimer = undefined;
    syncCodeSearchParam(urlSyncLastCode);
  }, debounceMs);
}

// ─── Twoslash ─────────────────────────────────────────────────────────────────

export const playgroundTwoslashConfig = {
  debounceMs: 500,
  peekHoverMs: 1000,
  compilerOptions: {
    target: 7,
    lib: ["dom", "es2020"],
    jsx: 4,
    jsxImportSource: "ilha",
    moduleResolution: 100,
    skipLibCheck: true,
  },
} satisfies TwoslashEditorOptions;

// ─── Preview iframe ───────────────────────────────────────────────────────────

/** Parent → iframe: `iframe.contentWindow.postMessage({ type: PREVIEW_MESSAGE_TYPE, code }, "*")` */
export const PREVIEW_MESSAGE_TYPE = "shedit-playground-preview-code";

/** Parent → iframe: sync `html.dark` with OS theme without reloading the shell. */
export const PREVIEW_THEME_MESSAGE_TYPE = "shedit-playground-preview-theme";

export function systemColorSchemeMediaQuery(): MediaQueryList {
  return window.matchMedia("(prefers-color-scheme: dark)");
}

/** Inline Areia tokens (Play CDN cannot run `@plugin "areia"`). From imprensa starter preview. */
const DEFAULT_PREVIEW_TAILWIND_STYLE = `
@theme {
  --color-areia-background: var(--color-white, #fff);
  --color-areia-foreground: oklch(21% 0.006 285.885);
  --color-areia-surface: var(--color-white, #fff);
  --color-areia-surface-muted: oklch(97% 0 0);
  --color-areia-surface-elevated: var(--color-white, #fff);
  --color-areia-overlay: oklch(0% 0 0 / 0.4);
  --color-areia-border: oklch(93.5% 0 0);
  --color-areia-ring: #ff7a37;
  --color-areia-divider: oklch(14.5% 0 0 / 0.1);
  --color-areia-primary: oklch(0.5772 0.2324 260);
  --color-areia-primary-foreground: var(--color-white, #fff);
  --color-areia-destructive: oklch(63.7% 0.237 25.331);
  --color-areia-destructive-foreground: var(--color-white, #fff);
  --color-areia-text-default: oklch(21% 0.006 285.885);
  --color-areia-text-strong: oklch(14.5% 0 0);
  --color-areia-text-subtle: oklch(55.6% 0 0);
  --color-areia-text-muted: oklch(70.8% 0 0);
  --color-areia-text-disabled: oklch(87% 0 0);
  --color-areia-control-background: var(--color-white, #fff);
  --color-areia-control-foreground: oklch(21% 0.006 285.885);
  --color-areia-control-border: oklch(93.5% 0 0);
  --color-areia-control-hover: oklch(97% 0 0);
  --color-areia-control-disabled: oklch(100% 0 0 / 0.5);
  --color-areia-control-disabled-foreground: oklch(87% 0 0);
}
.dark {
  --color-areia-background: oklch(10% 0 0);
  --color-areia-foreground: oklch(97% 0 0);
  --color-areia-surface: oklch(17% 0 0);
  --color-areia-surface-muted: oklch(26.9% 0 0);
  --color-areia-surface-elevated: oklch(20% 0 0);
  --color-areia-border: oklch(26.9% 0 0);
  --color-areia-divider: oklch(26.9% 0 0);
  --color-areia-text-default: oklch(97% 0 0);
  --color-areia-text-strong: oklch(98.5% 0 0);
  --color-areia-text-subtle: oklch(70.8% 0 0);
  --color-areia-text-muted: oklch(55.6% 0 0);
  --color-areia-text-disabled: oklch(43.9% 0 0);
  --color-areia-control-background: oklch(17% 0 0);
  --color-areia-control-foreground: oklch(97% 0 0);
  --color-areia-control-border: oklch(26.9% 0 0);
  --color-areia-control-hover: oklch(26.9% 0 0);
  --color-areia-control-disabled: oklch(17% 0 0 / 0.5);
  --color-areia-control-disabled-foreground: oklch(43.9% 0 0);
}
body {
  background: var(--color-areia-background, white);
  color: var(--color-areia-text-default);
}
`.trim();

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function buildPreviewTailwindCss(userStyle = ""): string {
  const extra = userStyle.trim();
  if (!extra) return DEFAULT_PREVIEW_TAILWIND_STYLE;
  return `${DEFAULT_PREVIEW_TAILWIND_STYLE}\n\n${extra}`;
}

function escapeTailwindCss(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

export function buildPreviewShellSrcdoc(tailwindThemeCss = ""): string {
  const transformUrl = PREVIEW_TRANSFORM_URL;
  const importMapJson = JSON.stringify({ imports: PREVIEW_IMPORT_MAP }, null, 2);
  const tailwindBlock = escapeTailwindCss(buildPreviewTailwindCss(tailwindThemeCss));
  const darkClass = systemPrefersDark() ? ` class="dark"` : "";
  const previewBgLight = "#ffffff";
  const previewBgDark = "oklch(10% 0 0)";
  const previewFgDark = "oklch(97% 0 0)";
  const initialDark = systemPrefersDark();
  return `<!DOCTYPE html>
<html lang="en"${darkClass}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html {
        background: ${previewBgLight};
        color-scheme: light;
      }
      html.dark {
        background: ${previewBgDark};
        color: ${previewFgDark};
        color-scheme: dark;
      }
      body {
        margin: 0;
        background: inherit;
        color: inherit;
      }
      #root {
        min-height: 100vh;
        padding: 1rem;
        background: inherit;
      }
      #preview-toaster {
        position: fixed;
        inset: 0;
        z-index: 9999;
        pointer-events: none;
      }
      #preview-toaster > * {
        pointer-events: auto;
      }
    </style>
    <script>
      (function () {
        var mq = window.matchMedia("(prefers-color-scheme: dark)");
        var THEME_MSG = ${JSON.stringify(PREVIEW_THEME_MESSAGE_TYPE)};
        function apply(dark) {
          document.documentElement.classList.toggle("dark", !!dark);
          document.documentElement.style.colorScheme = dark ? "dark" : "light";
        }
        apply(${initialDark ? "true" : "false"});
        mq.addEventListener("change", function () { apply(mq.matches); });
        window.addEventListener("message", function (event) {
          var data = event.data;
          if (!data || data.type !== THEME_MSG || typeof data.dark !== "boolean") return;
          apply(data.dark);
        });
      })();
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <style type="text/tailwindcss">${tailwindBlock}</style>
    <script type="importmap" id="importmap">${importMapJson.replace(/</g, "\\u003c")}</script>
    <style>
      .preview-error {
        margin: 1rem;
        padding: 0.75rem 1rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 6px;
        color: #991b1b;
        font: 13px/1.4 ui-monospace, monospace;
        white-space: pre-wrap;
      }
      html.dark .preview-error {
        background: #450a0a;
        border-color: #7f1d1d;
        color: #fecaca;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <div id="preview-toaster"></div>
    <script type="module">
      const MSG = ${JSON.stringify(PREVIEW_MESSAGE_TYPE)};
      const FALLBACK = ${JSON.stringify(DEFAULT_PLAYGROUND_CODE)};
      const TOASTER_BOOTSTRAP = ${JSON.stringify(PREVIEW_TOASTER_BOOTSTRAP)};
      const TRANSFORM_URL = ${JSON.stringify(transformUrl)};
      let runGen = 0;
      let toasterGen = 0;
      let transformChain = Promise.resolve();
      let toasterReady = Promise.resolve();
      let lastPreviewCode = FALLBACK;
      globalThis.__previewActiveGen = 0;
      globalThis.__previewLastUnmount = null;
      globalThis.__previewToasterUnmount = null;
      globalThis.__previewToasterMounted = false;

      function removeStalePreviewScripts() {
        document.querySelectorAll('[id^="preview-compiled"]').forEach((el) => el.remove());
      }

      function readImportMap() {
        const el = document.getElementById("importmap");
        if (!el?.textContent?.trim()) return {};
        try {
          return JSON.parse(el.textContent);
        } catch {
          return {};
        }
      }

      function showError(message) {
        resetMountSurface();
        const root = document.getElementById("root");
        if (!root) return;
        const pre = document.createElement("pre");
        pre.className = "preview-error";
        pre.textContent = message;
        root.appendChild(pre);
      }

      function resetMountSurface() {
        removeStalePreviewScripts();
        if (typeof globalThis.__previewLastUnmount === "function") {
          try {
            globalThis.__previewLastUnmount();
          } catch (_) {}
          globalThis.__previewLastUnmount = null;
        }
        const oldRoot = document.getElementById("root");
        if (!oldRoot) return;
        const next = document.createElement("div");
        next.id = "root";
        oldRoot.replaceWith(next);
      }

      function preprocessPreviewSource(source) {
        let s = source;
        const hasMount = /\\.mount\\s*\\(/.test(s);
        if (!hasMount && /export\\s+default\\b/.test(s)) {
          s = s.replace(/export\\s+default\\s+/, "const __previewDefaultExport = ");
          s =
            s.trimEnd() +
            "\\nexport default __previewDefaultExport;\\n" +
            "if (globalThis.__previewActiveGen === __PREVIEW_RUN_GEN) __previewMount(document.getElementById(\\"root\\"), __previewDefaultExport);\\n";
        }
        return s.replace(
          /([\\w$]+)\\.mount\\(\\s*(document\\.querySelector\\([^)]+\\))\\s*\\)/g,
          "__previewMount($2, $1)",
        );
      }

      const JSX_RUNTIME = ${JSON.stringify(PREVIEW_IMPORT_MAP["ilha/jsx-runtime"])};
      const JSX_DEV_RUNTIME = ${JSON.stringify(PREVIEW_IMPORT_MAP["ilha/jsx-dev-runtime"])};

      function normalizeTransformedJs(code) {
        return code
          .replace(/from\\s+[\"']react\\/jsx-runtime[\"']/g, 'from "' + JSX_RUNTIME + '"')
          .replace(/from\\s+[\"']react\\/jsx-dev-runtime[\"']/g, 'from "' + JSX_DEV_RUNTIME + '"');
      }

      function wrapCompiledModule(userJs, runGenId) {
        return [
          "const __PREVIEW_RUN_GEN = " + runGenId + ";",
          "const __previewUnmountFor = (key) => {",
          "  const fn = globalThis[key];",
          "  if (typeof fn === \\"function\\") {",
          "    try { fn(); } catch (_) {}",
          "    globalThis[key] = null;",
          "  }",
          "};",
          "const __previewMount = (el, island) => {",
          "  if (!el) return null;",
          "  if (el.id === \\"root\\" && globalThis.__previewActiveGen !== __PREVIEW_RUN_GEN) return null;",
          "  if (el.id === \\"root\\") __previewUnmountFor(\\"__previewLastUnmount\\");",
          "  if (el.id === \\"preview-toaster\\") __previewUnmountFor(\\"__previewToasterUnmount\\");",
          "  let result;",
          "  try {",
          "    result = island.mount(el);",
          "  } catch (err) {",
          "    console.error(\\"[playground preview] mount failed\\", err);",
          "    throw err;",
          "  }",
          "  const unmount = typeof result?.unmount === \\"function\\" ? result.unmount.bind(result) : null;",
          "  if (el.id === \\"root\\") globalThis.__previewLastUnmount = unmount;",
          "  if (el.id === \\"preview-toaster\\") globalThis.__previewToasterUnmount = unmount;",
          "  return result;",
          "};",
          userJs,
        ].join("\\n");
      }

      async function fetchWithRetry(url, init) {
        const delays = [300, 900, 2200];
        const retryStatus = new Set([429, 502, 503, 504]);
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch(url, init);
            if (res.ok || !retryStatus.has(res.status) || attempt === 2) return res;
            await res.body?.cancel?.().catch(function () {});
            lastErr = new Error("HTTP " + res.status);
          } catch (err) {
            lastErr = err;
            const msg = String(err && err.message ? err.message : err).toLowerCase();
            const net =
              err instanceof TypeError &&
              (msg.includes("failed to fetch") ||
                msg.includes("networkerror") ||
                msg.includes("load failed"));
            if (!net || attempt === 2) throw err;
          }
          const wait = delays[attempt] + Math.floor(Math.random() * (delays[attempt] * 0.25));
          await new Promise(function (r) {
            setTimeout(r, wait);
          });
        }
        throw lastErr || new Error("fetch failed");
      }

      function transformPreviewSource(source) {
        const run = async () => {
          const importMap = readImportMap();
          const body = JSON.stringify({
            filename: "/preview.tsx",
            lang: "tsx",
            code: source,
            target: "es2022",
            jsxImportSource: "ilha",
            importMap,
            minify: false,
          });
          const res = await fetchWithRetry(TRANSFORM_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          const text = await res.text();
          if (!res.ok) throw new Error("Transform failed (" + res.status + "): " + text.slice(0, 500));
          const payload = JSON.parse(text);
          if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
          return normalizeTransformedJs(payload.code);
        };
        const next = transformChain.then(run, run);
        transformChain = next.catch(() => {});
        return next;
      }

      function unmountPreviewToaster() {
        if (typeof globalThis.__previewToasterUnmount === "function") {
          try {
            globalThis.__previewToasterUnmount();
          } catch (_) {}
          globalThis.__previewToasterUnmount = null;
        }
        document
          .querySelectorAll('[id^="preview-toaster-compiled"]')
          .forEach((el) => el.remove());
        globalThis.__previewToasterMounted = false;
      }

      function preprocessToasterBootstrap(source) {
        let s = source.trim();
        s = s.replace(/export\\s+default\\s+/, "const __previewDefaultExport = ");
        return (
          s.trimEnd() +
          "\\nexport default __previewDefaultExport;\\n" +
          "__previewMount(document.getElementById(\\"preview-toaster\\"), __previewDefaultExport);\\n"
        );
      }

      async function mountPreviewToaster() {
        const host = document.getElementById("preview-toaster");
        if (!host) return;
        const gen = ++toasterGen;
        unmountPreviewToaster();
        try {
          const source = preprocessToasterBootstrap(TOASTER_BOOTSTRAP);
          const js = await transformPreviewSource(source);
          if (gen !== toasterGen) return;
          const mod = document.createElement("script");
          mod.type = "module";
          mod.id = "preview-toaster-compiled-" + gen;
          mod.textContent = wrapCompiledModule(js, gen);
          document.body.appendChild(mod);
          globalThis.__previewToasterMounted = true;
        } catch (err) {
          globalThis.__previewToasterMounted = false;
          console.warn("[playground preview] Toaster bootstrap failed:", err);
        }
      }

      toasterReady = mountPreviewToaster();

      window.addEventListener("error", (event) => {
        if (!event.filename?.includes("preview-compiled") && event.filename !== "") return;
        const msg = String(event.message || "");
        if (/already mounted/i.test(msg)) {
          showError("Preview mount conflict. Use the bar refresh button.");
          return;
        }
        showError(event.error?.stack || event.message || "Preview script error");
      });
      window.addEventListener("unhandledrejection", (event) => {
        const text = event.reason?.stack ? String(event.reason.stack) : String(event.reason ?? "");
        if (!text || /preview-toaster/i.test(text)) return;
        showError(text);
      });

      async function runUserCode(code) {
        await toasterReady;
        if (!globalThis.__previewToasterMounted) {
          toasterReady = mountPreviewToaster();
          await toasterReady;
        }
        const gen = ++runGen;
        globalThis.__previewActiveGen = gen;
        lastPreviewCode = code.trim() || FALLBACK;
        removeStalePreviewScripts();

        const source = preprocessPreviewSource(lastPreviewCode);

        let userJs;
        try {
          userJs = await transformPreviewSource(source);
        } catch (err) {
          if (gen !== runGen) return;
          const msg = String(err && err.message ? err.message : err);
          showError(
            msg.includes("Transform failed") || msg.includes("fetch")
              ? "Preview could not reach esm.sh (transform or CDN).\\n\\n" + msg
              : msg,
          );
          return;
        }

        if (gen !== runGen) return;

        removeStalePreviewScripts();
        resetMountSurface();

        const mod = document.createElement("script");
        mod.type = "module";
        mod.id = "preview-compiled-" + gen;
        mod.textContent = wrapCompiledModule(userJs, gen);
        document.body.appendChild(mod);
      }

      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || data.type !== MSG) return;
        if (typeof data.code !== "string") return;
        const trimmed = data.code.trim();
        if (trimmed === lastPreviewCode.trim() && runGen > 0) return;
        void runUserCode(data.code);
      });
    </script>
  </body>
</html>`;
}

export function postPreviewCode(iframe: HTMLIFrameElement, code: string): void {
  const win = iframe.contentWindow;
  if (!win) return;
  win.postMessage({ type: PREVIEW_MESSAGE_TYPE, code }, "*");
}

export function postPreviewTheme(iframe: HTMLIFrameElement, dark: boolean): void {
  const win = iframe.contentWindow;
  if (!win) return;
  win.postMessage({ type: PREVIEW_THEME_MESSAGE_TYPE, dark }, "*");
}
