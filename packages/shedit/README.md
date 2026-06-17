# shedit

Ilha code editor with **Shiki** syntax highlighting via the **CSS Custom Highlight API** (no per-token DOM spans in the mirror).

## Requirements

- **Browser:** `CSS.highlights` (Chrome 105+, Safari 17.2+, Firefox 140+)
- **Peers:** `ilha` ^0.8, `shiki` ^4

## Quick start

```ts
import { createHighlighter } from "shiki/bundle/web";
import { Editor } from "shedit";

const shiki = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["typescript"],
});

Editor.mount(document.querySelector("#app")!, {
  shiki,
  lang: "typescript",
  themes: { light: "github-light", dark: "github-dark" },
  theme: "system", // "light" | "dark" | "system"
  value: "const x = 1\n",
  ariaLabel: "Source editor",
  onChange: (v) => console.log(v.length),
});
```

Imperative mount:

```ts
import { createShikiEditor } from "shedit";

createShikiEditor(container, { shiki, lang, themes, value: "" });
```

## Static blocks (markdown / SSR)

Re-exported from [shiki-highlight-api](https://github.com/shiki-highlights/shiki-highlight-api):

```ts
import { codeToHighlightHtml } from "shedit";
```

## Styling (BEM + tokens)

Block: `.shedit`. Override on the host:

```css
.shedit {
  --shedit-font-family: "Iosevka", monospace;
  --shedit-pad-x: 12px;
  --shedit-pad-y: 12px;
}
```

Ilha scopes island CSS; `data-theme="light|dark"` is set from `theme` / system preference.

## Layout props

| Prop            | Default              |
| --------------- | -------------------- |
| `lineHeight`    | 22                   |
| `tabSize`       | 2                    |
| `padX` / `padY` | 16                   |
| `fontSize`      | 14                   |
| `fontFamily`    | JetBrains Mono stack |

## Twoslash (default on for TS/JS/TSX)

Type hovers use a debounced overlay (syntax highlight stays on the fast CSS layer). **Opt out:** `twoslash: false`.

Link `@shikijs/twoslash/style-rich.css`. Hover a symbol ~**1s** for a peek, or hold **Ctrl** / **⌘** for immediate hovers. For `import "pkg"` from npm, typings are fetched automatically ([esm.sh](https://esm.sh) + ATA). Override with `twoslash: { compilerOptions, virtualFiles, peekHoverMs: false, … }` only when needed.

Peers: `typescript` (shedit pins 5.7.3 for `twoslash-cdn`).

## Test app

```bash
cd packages/shedit && bun test/index.html
```
