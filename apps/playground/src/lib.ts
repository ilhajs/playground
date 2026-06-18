import type { TwoslashEditorOptions } from "shedit";

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

/** Areia Sonner shell — mounted once into #preview-toaster (see areia.ilha.build/components/sonner). */
export const PREVIEW_TOASTER_BOOTSTRAP = `import ilha from "ilha";
import { Toaster } from "areia";

export default ilha.render(() => (
  <Toaster position="bottom-right" closeButton richColors theme="system" />
));
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

/** iframe → parent: preview hit a network/CDN error (parent may show a reload control). */
export const PREVIEW_ISSUE_MESSAGE_TYPE = "shedit-playground-preview-issue";

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
    <script type="importmap" id="importmap">
      {
        "imports": {
          "ilha": "https://esm.sh/ilha",
          "areia": "https://esm.sh/areia?deps=ilha",
          "sonner": "https://esm.sh/sonner",
          "quando": "https://esm.sh/quando",
          "ilha/jsx-runtime": "https://esm.sh/ilha/jsx-runtime",
          "ilha/jsx-dev-runtime": "https://esm.sh/ilha/jsx-dev-runtime",
          "react/jsx-runtime": "https://esm.sh/ilha/jsx-runtime",
          "react/jsx-dev-runtime": "https://esm.sh/ilha/jsx-dev-runtime"
        }
      }
    </script>
    <style>
      .preview-error-panel {
        margin: 1rem;
        padding: 1rem 1.25rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #991b1b;
        font: 13px/1.45 system-ui, sans-serif;
      }
      html.dark .preview-error-panel {
        background: #450a0a;
        border-color: #7f1d1d;
        color: #fecaca;
      }
      .preview-error-panel pre {
        margin: 0 0 0.75rem;
        font: 12px/1.4 ui-monospace, monospace;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .preview-error-panel button {
        font: inherit;
        font-weight: 500;
        padding: 0.4rem 0.85rem;
        border-radius: 6px;
        border: 1px solid #fecaca;
        background: #fff;
        color: #991b1b;
        cursor: pointer;
      }
      html.dark .preview-error-panel button {
        background: oklch(17% 0 0);
        border-color: #7f1d1d;
        color: #fecaca;
      }
      .preview-error-panel button:hover {
        filter: brightness(0.97);
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
      const TRANSFORM_URL = "https://esm.sh/transform";
      let runGen = 0;
      let toasterGen = 0;
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

      function isLikelyNetworkError(err) {
        const msg = String(err && err.message ? err.message : err).toLowerCase();
        return (
          msg.includes("failed to fetch") ||
          msg.includes("networkerror") ||
          msg.includes("load failed") ||
          msg.includes("transform failed")
        );
      }

      function showError(message, options) {
        const opts = options || {};
        resetMountSurface();
        const root = document.getElementById("root");
        if (!root) return;
        const panel = document.createElement("div");
        panel.className = "preview-error-panel";
        const pre = document.createElement("pre");
        pre.textContent = message;
        panel.appendChild(pre);
        const showRetry =
          opts.retry !== false &&
          (opts.network || isLikelyNetworkError(message));
        if (showRetry) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "Reload preview";
          btn.addEventListener("click", () => {
            void runUserCode(lastPreviewCode);
          });
          panel.appendChild(btn);
        }
        root.appendChild(panel);
        if (showRetry) {
          try {
            parent.postMessage(
              { type: ${JSON.stringify(PREVIEW_ISSUE_MESSAGE_TYPE)}, network: true },
              "*",
            );
          } catch (_) {}
        }
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
            "if (globalThis.__previewActiveGen === __PREVIEW_RUN_GEN) __previewMount(document.querySelector(\\"#root\\"), __previewDefaultExport);\\n";
        }
        return s.replace(
          /([\\w$]+)\\.mount\\(\\s*(document\\.querySelector\\([^)]+\\))\\s*\\)/g,
          "__previewMount($2, $1)",
        );
      }

      function normalizeTransformedJs(code) {
        return code
          .replace(/from\\s+[\"']react\\/jsx-runtime[\"']/g, 'from "https://esm.sh/ilha/jsx-runtime"')
          .replace(/from\\s+[\"']react\\/jsx-dev-runtime[\"']/g, 'from "https://esm.sh/ilha/jsx-dev-runtime"');
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

      async function transformPreviewSource(source) {
        const importMap = readImportMap();
        const res = await fetch(TRANSFORM_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "/preview.tsx",
            lang: "tsx",
            code: source,
            target: "es2022",
            jsxImportSource: "ilha",
            importMap,
            minify: false,
          }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error("Transform failed (" + res.status + "): " + text.slice(0, 500));
        const payload = JSON.parse(text);
        if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
        return normalizeTransformedJs(payload.code);
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

      async function mountPreviewToaster() {
        const host = document.getElementById("preview-toaster");
        if (!host) return;
        const gen = ++toasterGen;
        unmountPreviewToaster();
        try {
          const source = preprocessPreviewSource(TOASTER_BOOTSTRAP);
          const js = await transformPreviewSource(source);
          if (gen !== toasterGen) return;
          const mod = document.createElement("script");
          mod.type = "module";
          mod.id = "preview-toaster-compiled-" + gen;
          mod.textContent =
            wrapCompiledModule(js, gen) +
            "\\nif (globalThis.__previewToasterGen === " +
            gen +
            ") __previewMount(document.getElementById(\\"preview-toaster\\"), __previewDefaultExport);";
          globalThis.__previewToasterGen = gen;
          document.body.appendChild(mod);
          globalThis.__previewToasterMounted = true;
        } catch (err) {
          console.warn("[playground preview] Toaster bootstrap failed:", err);
        }
      }

      void mountPreviewToaster();

      window.addEventListener("error", (event) => {
        const fromUserPreview = event.filename?.includes("preview-compiled");
        const fromToaster = event.filename?.includes("preview-toaster");
        if (!fromUserPreview && !fromToaster && event.filename !== "") return;
        if (fromToaster) {
          console.warn("[playground preview] toaster error", event.message);
          return;
        }
        const msg = String(event.message || "");
        if (/already mounted/i.test(msg)) {
          showError(
            "Preview mount conflict (stale run). Click Reload preview to try again.",
            { network: true },
          );
          return;
        }
        showError(
          (event.error && event.error.stack) ||
            event.message ||
            "Preview script error",
        );
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        const text = reason && reason.stack ? String(reason.stack) : String(reason ?? "");
        if (!text || /preview-toaster/i.test(text)) return;
        showError(text || "Unhandled promise rejection");
      });

      async function runUserCode(code) {
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
            { network: isLikelyNetworkError(err) },
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
