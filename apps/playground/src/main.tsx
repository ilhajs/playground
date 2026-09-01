import "@chakra-ui/css-reset";
import "./app.css";
import "@shikijs/twoslash/style-rich.css";
import "@fontsource-variable/geist";
import type { BundledTheme } from "shiki";
import { createHighlighter } from "shiki/bundle/web";
import { Editor, type ShikiEditorHandle } from "shedit";
import { atom, mount } from "ilha";
import {
  buildPreviewShellSrcdoc,
  DEFAULT_PLAYGROUND_CODE,
  navigateWithLayout,
  navigateWithMode,
  parsePlaygroundSettings,
  playgroundTwoslashConfig,
  postPreviewCode,
  postPreviewTheme,
  PREVIEW_MESSAGE_TYPE,
  systemColorSchemeMediaQuery,
  systemPrefersDark,
  scheduleCodeSearchParamSync,
  syncCodeSearchParam,
} from "./lib.ts";
import { resetPreviewImportMapCache, resolvePreviewImportMap } from "./preview-cdn.ts";

const PREVIEW_DEBOUNCE_MS = 400;
const URL_SYNC_DEBOUNCE_MS = 400;
const themes = { light: "github-light", dark: "github-dark" } satisfies Record<
  string,
  BundledTheme
>;

const app = document.querySelector<HTMLElement>("#app")!;

const initialSettings = parsePlaygroundSettings(location.search);
/** Set once from URL before first paint; Editor must not receive reactive `value`. */
const editorSeed = initialSettings.code || DEFAULT_PLAYGROUND_CODE;
/** Live document; not in Ilha state so typing does not re-render the app (preserves shedit undo). */
let liveEditorCode = editorSeed;
let lastPostedPreview = "";
let previewDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function getEditorHandle(): ShikiEditorHandle | undefined {
  return document.querySelector<HTMLElement & { shedit?: ShikiEditorHandle }>(
    ".editor-pane .shedit",
  )?.shedit;
}

function getEditorCode(): string {
  return getEditorHandle()?.getValue() ?? liveEditorCode;
}

function schedulePreviewFromEditor(
  iframe: HTMLIFrameElement,
  debounceMs = PREVIEW_DEBOUNCE_MS,
): void {
  if (previewDebounceTimer !== undefined) clearTimeout(previewDebounceTimer);
  previewDebounceTimer = window.setTimeout(() => {
    previewDebounceTimer = undefined;
    schedulePreviewPost(iframe, getEditorCode());
  }, debounceMs);
}

const shiki = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["tsx"],
});

const previewImportMap = await resolvePreviewImportMap();

function schedulePreviewPost(iframe: HTMLIFrameElement, code: string): void {
  if (code === lastPostedPreview) return;
  lastPostedPreview = code;
  postPreviewCode(iframe, code);
}

const PLAYGROUND_CSS = `
  body {
    margin: 0;
    font-family: "Geist Variable", sans-serif;
    overflow: hidden;
  }
  [data-ilha-slot] {
    display: contents;
  }
  .layout {
    --color-areia-background: var(--color-white, #fff);
    --color-areia-border: oklch(93.5% 0 0);
    box-sizing: border-box;
    height: 100dvh;
    width: 100%;
    overflow: hidden;
    display: flex;
  }
  @media (prefers-color-scheme: dark) {
    .layout {
      --color-areia-background: oklch(10% 0 0);
      --color-areia-border: oklch(26.9% 0 0);
    }
  }
  .layout--horizontal {
    flex-direction: row;
  }
  .layout--vertical {
    flex-direction: column;
  }
  .layout--horizontal .editor-pane {
    border-right: 1px solid var(--color-areia-border);
  }
  .layout--vertical .editor-pane {
    border-bottom: 1px solid var(--color-areia-border);
  }
  .editor-pane,
  .preview-pane {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .layout--vertical .editor-pane,
  .layout--vertical .preview-pane {
    flex-basis: 50%;
  }
  @media (max-width: 768px) {
    .layout--horizontal {
      flex-direction: column;
    }
    .layout--horizontal .editor-pane {
      border-right: none;
      border-bottom: 1px solid var(--color-areia-border);
    }
    .layout--horizontal .editor-pane,
    .layout--horizontal .preview-pane {
      flex-basis: 50%;
    }
  }
  .editor-pane .shedit {
    flex: 1 1 auto;
    min-height: 0;
  }
  .preview-pane .preview {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border: none;
    background: var(--color-areia-background);
  }
  .playground-bar {
    position: fixed;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    background: var(--playground-bar-bg, #f5f5f5);
    border-top: 1px solid var(--playground-bar-border, #e8e8e8);
    border-left: 1px solid var(--playground-bar-border, #e8e8e8);
    border-top-left-radius: 6px;
    --playground-bar-bg-active: #e0e0e0;
    --playground-bar-icon-filter: none;
  }
  @media (prefers-color-scheme: dark) {
    .playground-bar {
      --playground-bar-bg: #252526;
      --playground-bar-border: #2d2d2d;
      --playground-bar-fg: #8a8a8a;
      --playground-bar-fg-hover: #e8e8e8;
      --playground-bar-bg-hover: #2d2d2d;
      --playground-bar-bg-active: oklch(17% 0 0);
      --playground-bar-icon-filter: invert(1) brightness(1.05);
    }
  }
  .playground-bar__link {
    margin-right: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--playground-bar-fg, #999999);
    text-decoration: none;
  }
  .playground-bar__link:hover {
    color: var(--playground-bar-fg-hover, #333333);
    background: var(--playground-bar-bg-hover, #e8e8e8);
  }
  .playground-bar__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--playground-bar-fg, #999999);
    cursor: pointer;
  }
  .playground-bar__btn:hover {
    color: var(--playground-bar-fg-hover, #333333);
    background: var(--playground-bar-bg-hover, #e8e8e8);
  }
  .playground-bar__btn--active {
    color: var(--playground-bar-fg-hover, #333333);
    background: var(--playground-bar-bg-active, #e0e0e0);
  }
  .playground-bar__btn--active:hover {
    background: var(--playground-bar-bg-active, #e0e0e0);
  }
  .playground-bar__btn img {
    width: 18px;
    height: 18px;
    display: block;
    opacity: 0.85;
    filter: var(--playground-bar-icon-filter);
  }
  .playground-bar__btn:hover img,
  .playground-bar__btn--active img {
    opacity: 1;
  }
`;

let layoutSetupCleanups: (() => void)[] = [];
let layoutSetupGen = 0;

function layoutRef(host: Element | null): void {
  if (host) {
    const gen = ++layoutSetupGen;
    queueMicrotask(() => {
      if (gen !== layoutSetupGen) return;
      const iframe = host.querySelector<HTMLIFrameElement>("iframe.preview");
      layoutSetupCleanups = [];

      if (iframe) {
        iframe.srcdoc = buildPreviewShellSrcdoc(initialSettings.style, previewImportMap);
        const onIframeLoad = () => {
          schedulePreviewPost(iframe, getEditorCode());
          postPreviewTheme(iframe, systemPrefersDark());
        };
        iframe.addEventListener("load", onIframeLoad, { once: true });

        const themeMq = systemColorSchemeMediaQuery();
        const onSystemThemeChange = () => {
          postPreviewTheme(iframe, themeMq.matches);
        };
        themeMq.addEventListener("change", onSystemThemeChange);
        layoutSetupCleanups.push(() => themeMq.removeEventListener("change", onSystemThemeChange));
      }

      const wireEditor = (root: HTMLElement & { shedit?: ShikiEditorHandle }) => {
        root.shedit?.setOnChange((v) => {
          liveEditorCode = v;
          scheduleCodeSearchParamSync(v, URL_SYNC_DEBOUNCE_MS);
          if (iframe) schedulePreviewFromEditor(iframe);
        });
      };

      const onEditorReady = (event: Event) => {
        const root = event.target;
        if (!(root instanceof HTMLElement) || !host.contains(root)) return;
        wireEditor(root as HTMLElement & { shedit?: ShikiEditorHandle });
      };
      host.addEventListener("shedit:ready", onEditorReady);
      layoutSetupCleanups.push(() => host.removeEventListener("shedit:ready", onEditorReady));

      const existing = host.querySelector<HTMLElement & { shedit?: ShikiEditorHandle }>(
        ".editor-pane .shedit",
      );
      if (existing?.shedit) wireEditor(existing);

      if (initialSettings.mode === "preview") {
        const onParentMessage = (event: MessageEvent) => {
          const data = event.data;
          if (!data || data.type !== PREVIEW_MESSAGE_TYPE || typeof data.code !== "string") return;
          liveEditorCode = data.code;
          const el = document.querySelector<HTMLIFrameElement>("iframe.preview");
          if (el) schedulePreviewPost(el, data.code);
        };
        window.addEventListener("message", onParentMessage);
        layoutSetupCleanups.push(() => window.removeEventListener("message", onParentMessage));
      }
    });
  } else {
    layoutSetupGen++;
    for (const fn of layoutSetupCleanups) fn();
    layoutSetupCleanups = [];
  }
}

function App() {
  const settings = atom(initialSettings);

  systemAppStyles();

  const onLayoutToggle = () => {
    const next = settings().layout === "horizontal" ? "vertical" : "horizontal";
    syncCodeSearchParam(getEditorCode());
    navigateWithLayout(next);
  };
  const onModeToggle = () => {
    const next = settings().mode === "editor" ? "preview" : "editor";
    syncCodeSearchParam(getEditorCode());
    navigateWithMode(next);
  };
  const onOpenExternal = () => {
    window.open(location.href, "_blank", "noopener,noreferrer");
  };
  const onPreviewRefresh = async () => {
    const iframe = document.querySelector<HTMLIFrameElement>("iframe.preview");
    if (!iframe) return;
    lastPostedPreview = "";
    resetPreviewImportMapCache();
    const map = await resolvePreviewImportMap();
    const { style } = settings();
    const onLoad = () => {
      schedulePreviewPost(iframe, getEditorCode());
      postPreviewTheme(iframe, systemPrefersDark());
      iframe.removeEventListener("load", onLoad);
    };
    iframe.addEventListener("load", onLoad);
    iframe.srcdoc = buildPreviewShellSrcdoc(style, map);
  };

  const { mode, layout } = settings();
  const showEditor = mode !== "preview";
  const layoutClass = mode === "preview" ? "layout--preview-only" : `layout--${layout}`;

  return (
    <>
      <div class={`layout ${layoutClass}`} ref={layoutRef}>
        {showEditor ? (
          <div class="editor-pane">
            <Editor
              shiki={shiki}
              lang="tsx"
              themes={themes}
              theme="system"
              value={editorSeed}
              placeholder="Write Ilha TSX here…"
              ariaLabel="TSX editor (hover ~1s or hold Ctrl/⌘ for types)"
              twoslash={playgroundTwoslashConfig}
            />
          </div>
        ) : null}
        <div class="preview-pane">
          <iframe
            class="preview"
            title="Ilha preview"
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
          />
        </div>
      </div>
      <div class="playground-bar">
        <a
          class="playground-bar__link"
          href="https://ilha.build"
          target="_blank"
          rel="noopener noreferrer"
        >
          ilha.build
        </a>
        <button
          type="button"
          class={`playground-bar__btn${mode === "editor" ? " playground-bar__btn--active" : ""}`}
          onclick={onModeToggle}
          aria-label={mode === "editor" ? "Switch to preview only" : "Switch to editor"}
          title={mode === "editor" ? "Preview only" : "Editor"}
        >
          <img src="/code.svg" alt="" width="18" height="18" />
        </button>
        {showEditor ? (
          <button
            type="button"
            class={`playground-bar__btn${layout === "vertical" ? " playground-bar__btn--active" : ""}`}
            onclick={onLayoutToggle}
            aria-label={
              layout === "horizontal" ? "Switch to vertical layout" : "Switch to horizontal layout"
            }
            title={layout === "horizontal" ? "Vertical layout" : "Horizontal layout"}
          >
            <img src="/rows-2.svg" alt="" width="18" height="18" />
          </button>
        ) : null}
        <button
          type="button"
          class="playground-bar__btn"
          onclick={onPreviewRefresh}
          aria-label="Reload preview iframe"
          title="Reload preview"
        >
          <img src="/refresh.svg" alt="" width="18" height="18" />
        </button>
        <button
          type="button"
          class="playground-bar__btn"
          onclick={onOpenExternal}
          aria-label="Open current URL in new tab"
          title="Open in new tab"
        >
          <img src="/external-link.svg" alt="" width="18" height="18" />
        </button>
      </div>
    </>
  );
}

mount(app, App);

function systemAppStyles(): void {
  const id = "playground-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = PLAYGROUND_CSS;
  document.head.appendChild(style);
}
