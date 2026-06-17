import "@chakra-ui/css-reset";
import "@shikijs/twoslash/style-rich.css";
import "@fontsource-variable/geist";
import type { BundledTheme } from "shiki";
import { createHighlighter } from "shiki/bundle/web";
import { Editor, type ShikiEditorHandle } from "shedit";
import ilha from "ilha";
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
  type PlaygroundSettings,
} from "./lib.ts";

const PREVIEW_DEBOUNCE_MS = 400;
const URL_SYNC_DEBOUNCE_MS = 400;
const themes = { light: "github-light", dark: "github-dark" } satisfies Record<
  string,
  BundledTheme
>;

const app = document.querySelector<HTMLElement>("#app")!;

const initialSettings = parsePlaygroundSettings(location.search);
/** Set once from URL before first paint; Editor must not receive reactive `value`. */
let editorSeed = initialSettings.code || DEFAULT_PLAYGROUND_CODE;
let lastPostedPreview = "";

const shiki = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["tsx"],
});

function schedulePreviewPost(iframe: HTMLIFrameElement, code: string): void {
  if (code === lastPostedPreview) return;
  lastPostedPreview = code;
  postPreviewCode(iframe, code);
}

const App = ilha
  .state("settings", (): PlaygroundSettings => initialSettings)
  .state("source", () => editorSeed).css`
  body {
    margin: 0;
    font-family: "Geist Variable", sans-serif;
  }
  [data-ilha-slot] {
    display: contents;
  }
  .layout {
    --color-areia-background: var(--color-white, #fff);
    --color-areia-border: oklch(93.5% 0 0);
    min-height: 100vh;
    width: 100%;
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
  .layout--horizontal .editor {
    border-right: 1px solid var(--color-areia-border);
  }
  .layout--vertical .editor {
    border-bottom: 1px solid var(--color-areia-border);
  }
  .preview {
    flex: 1;
    border: none;
    width: 100%;
    min-height: 0;
    background: var(--color-areia-background);
  }
  .editor {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .layout--preview-only .preview {
    flex: 1 1 auto;
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
  `
  .onMount(({ state }) => {
    const iframe = document.querySelector<HTMLIFrameElement>("iframe.preview");
    const cleanups: (() => void)[] = [];

    if (iframe) {
      const setPreviewShell = () => {
        iframe.srcdoc = buildPreviewShellSrcdoc(initialSettings.style);
      };
      setPreviewShell();
      const onIframeLoad = () => {
        schedulePreviewPost(iframe, state.source());
        postPreviewTheme(iframe, systemPrefersDark());
      };
      iframe.addEventListener("load", onIframeLoad, { once: true });

      const themeMq = systemColorSchemeMediaQuery();
      const onSystemThemeChange = () => {
        postPreviewTheme(iframe, themeMq.matches);
      };
      themeMq.addEventListener("change", onSystemThemeChange);
      cleanups.push(() => themeMq.removeEventListener("change", onSystemThemeChange));
    }

    const wireEditorOnChange = (): void => {
      document
        .querySelector<HTMLElement & { shedit?: ShikiEditorHandle }>(".editor .shedit")
        ?.shedit?.setOnChange((v) => {
          state.source(v);
          scheduleCodeSearchParamSync(v, URL_SYNC_DEBOUNCE_MS);
        });
    };
    wireEditorOnChange();
    queueMicrotask(wireEditorOnChange);

    if (initialSettings.mode === "preview") {
      const onParentMessage = (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.type !== PREVIEW_MESSAGE_TYPE || typeof data.code !== "string") return;
        state.source(data.code);
        const el = document.querySelector<HTMLIFrameElement>("iframe.preview");
        if (el) schedulePreviewPost(el, data.code);
      };
      window.addEventListener("message", onParentMessage);
      cleanups.push(() => window.removeEventListener("message", onParentMessage));
    }

    return () => {
      for (const fn of cleanups) fn();
    };
  })
  .effect(({ state }) => {
    const iframe = document.querySelector<HTMLIFrameElement>("iframe.preview");
    if (!iframe) return;

    const code = state.source();
    const timer = window.setTimeout(() => {
      schedulePreviewPost(iframe, code);
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  })

  .on("[data-action=layout-toggle]@click", ({ state }) => {
    const layout = state.settings().layout;
    const next = layout === "horizontal" ? "vertical" : "horizontal";
    syncCodeSearchParam(state.source());
    navigateWithLayout(next);
  })
  .on("[data-action=mode-toggle]@click", ({ state }) => {
    const mode = state.settings().mode;
    const next = mode === "editor" ? "preview" : "editor";
    syncCodeSearchParam(state.source());
    navigateWithMode(next);
  })
  .on("[data-action=open-external]@click", () => {
    window.open(location.href, "_blank", "noopener,noreferrer");
  })
  .render(({ state }) => {
    const { mode, layout } = state.settings();
    const showEditor = mode !== "preview";
    const layoutClass = mode === "preview" ? "layout--preview-only" : `layout--${layout}`;

    return (
      <>
        <div class={`layout ${layoutClass}`}>
          {showEditor ? (
            <div class="editor">
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
          <iframe
            class="preview"
            title="Ilha preview"
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
          />
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
            data-action="mode-toggle"
            aria-label={mode === "editor" ? "Switch to preview only" : "Switch to editor"}
            title={mode === "editor" ? "Preview only" : "Editor"}
          >
            <img src="/code.svg" alt="" width="18" height="18" />
          </button>
          {showEditor ? (
            <button
              type="button"
              class={`playground-bar__btn${layout === "vertical" ? " playground-bar__btn--active" : ""}`}
              data-action="layout-toggle"
              aria-label={
                layout === "horizontal"
                  ? "Switch to vertical layout"
                  : "Switch to horizontal layout"
              }
              title={layout === "horizontal" ? "Vertical layout" : "Horizontal layout"}
            >
              <img src="/rows-2.svg" alt="" width="18" height="18" />
            </button>
          ) : null}
          <button
            type="button"
            class="playground-bar__btn"
            data-action="open-external"
            aria-label="Open current URL in new tab"
            title="Open in new tab"
          >
            <img src="/external-link.svg" alt="" width="18" height="18" />
          </button>
        </div>
      </>
    );
  });

App.mount(app);
