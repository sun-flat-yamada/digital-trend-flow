# Walkthrough: Split the Pages generator and convert Markdown with markdown-it (#56)

## Summary
The site's stylesheet and client script are static files copied into `_site/`. The client script reads its UI strings from a JSON block in index.html. Markdown is converted by markdown-it with raw HTML disabled. `pages_generator.ts` went from about 2,250 lines to 783.

## Changes Made
- [src/publishing/pages_assets/styles.css](../../../src/publishing/pages_assets/styles.css), [src/publishing/pages_assets/app.js](../../../src/publishing/pages_assets/app.js): taken from the generated output (Prettier-formatted). The only code change is `app.js` reading `I18N` from `#i18n-data`.
- [src/publishing/markdown_html.ts](../../../src/publishing/markdown_html.ts): the markdown-it converter (http(s) links only, no images, scheme-only linkify, site CSS classes, safe `<details>` lines).
- [src/publishing/pages_generator.ts](../../../src/publishing/pages_generator.ts): copies the assets and writes the i18n JSON. The CSS/JS templates and the hand-written converter are removed. `markdownToHtml` is re-exported for the email notifier and note.com.
- [src/core/paths.ts](../../../src/core/paths.ts): `PATHS.PAGES_ASSETS`.
- [package.json](../../../package.json): `markdown-it` 15.0.2; `overrides` pins its `argparse` to 3.0.2.
- [tests/pages_generator.test.ts](../../../tests/pages_generator.test.ts): conversion, link safety, i18n block and asset tests.
- Docs: `AGENTS.md`, `docs/architecture.md`, `docs/improvement-plan.md`.

## Before / after (same sample summary, Chromium screenshots)
- Numbered lists render as `<ol>` (before: paragraphs starting with "1.").
- A citation line indented under a list item stays inside the item, after a line break (before: a separate source box after the item).
- Consecutive lines of a paragraph become one paragraph joined by `<br>` (before: one `<p>` per line). Tables and fenced code now render.
- `styles.css` is the same apart from formatting. No console errors on either page.

## Verification Results
| Stage | Command | Result |
| :--- | :--- | :--- |
| Type check | `npm run type-check` | ✅ |
| Lint / format | `npm run lint && npm run format:check` | ✅ |
| Config | `npm run test:config` | ✅ |
| Tests + coverage | `npm run test:coverage` | ✅ 48 suites / 358 tests |
| Build | `npm run build` | ✅ |
| Plan-first | `npm run change-dev:plan-check` | ✅ |
| Manual | before/after site generation + Playwright screenshots | ✅ |

Note: the implementation was drafted before the change-dev workflow reached `main` in this session. The plan was then committed on its own, before the implementation commit.
