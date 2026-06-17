import type { BundledLanguage, BundledTheme } from "shiki";
import { createHighlighter } from "shiki/bundle/web";
import { Editor } from "../src/index.ts";

const app = document.querySelector<HTMLElement>("#app")!;
app.style.height = "100vh";
app.style.display = "flex";

const shiki = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["typescript", "javascript"],
});

const lang = "typescript" satisfies BundledLanguage;
const themes = { light: "github-light", dark: "github-dark" } satisfies Record<
  string,
  BundledTheme
>;

Editor.mount(app, {
  shiki,
  lang,
  themes,
  theme: "system",
  ariaLabel: "TypeScript editor (hover ~1s or hold Ctrl/⌘ for types)",
  value: `const count = 0

const doubled = count * 2
`,
  onChange: (v) => console.log("chars", v.length),
});
