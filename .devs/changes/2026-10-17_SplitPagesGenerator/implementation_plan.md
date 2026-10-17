# Split the Pages generator and convert Markdown with markdown-it (#56)

`src/publishing/pages_generator.ts` is ~2,250 lines because it embeds the site's CSS and client script as template strings, and its hand-written `markdownToHtml` does not support numbered lists, tables or code blocks (PUB-8, plan 4-4).

## User Review Required
> [!IMPORTANT]
> Rendering changes (intended): numbered lists render as `<ol>`, a citation line indented under a list item stays inside that item, tables and fenced code render, consecutive lines of a paragraph become one paragraph with line breaks (`<br>`). The PR lists the before / after differences.

> [!WARNING]
> New runtime dependency `markdown-it` pinned to `15.0.2` (released 2026-09-11). Its transitive `argparse` is pinned to `3.0.2` with `overrides`, because the latest `3.0.3` is two days old.

## Proposed Changes
### Static assets
#### [NEW] [src/publishing/pages_assets/styles.css](../../../src/publishing/pages_assets/styles.css)
- The stylesheet, unchanged apart from Prettier formatting.
#### [NEW] [src/publishing/pages_assets/app.js](../../../src/publishing/pages_assets/app.js)
- The client script; it reads the UI strings from a JSON block (`<script id="i18n-data" type="application/json">`) instead of having them templated in, so the file is static. CSP (`script-src 'self'`) is unchanged.
#### [MODIFY] [src/publishing/pages_generator.ts](../../../src/publishing/pages_generator.ts)
- Copy the assets into `_site/` (`PATHS.PAGES_ASSETS`), write the i18n JSON into index.html, drop `generateCss` / `generateJs` and the hand-written converter.
### Markdown
#### [NEW] [src/publishing/markdown_html.ts](../../../src/publishing/markdown_html.ts)
- `markdownToHtml` on markdown-it (`html: false`, http(s) links only, no images, plain-URL linkify without fuzzy domains), the site's CSS classes, and the fixed `<details>` / `<summary>` lines of the metrics block rebuilt as before. `pages_generator.ts` re-exports it for the email notifier and note.com.
#### [MODIFY] [package.json](../../../package.json), package-lock.json
- `markdown-it@15.0.2`, `overrides.markdown-it.argparse = 3.0.2`.
### Docs
- `AGENTS.md`, `docs/architecture.md`, `docs/improvement-plan.md` (4-4, PUB-8).

## Verification Plan
### Automated Tests
- Quality gate.
- `tests/pages_generator.test.ts`: existing tests kept; new tests for numbered lists, link safety, tables / code / quotes, details around a table, the i18n block and the copied assets.
### Manual Verification
- Generate the site from the same sample summary before and after, diff the outputs and compare screenshots (Playwright, Chromium).
