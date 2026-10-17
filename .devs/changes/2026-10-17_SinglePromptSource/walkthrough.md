# Walkthrough: Make prompts/ the single prompt source and record the prompts used (#44)

## Summary
`prompts/` is now the only prompt definition: a missing manifest entry, file or placeholder value is an error. The daily Reduce prompt moved to `reduce_{ja,en}_v1.md`; the weekly, monthly and yearly prompts have Japanese and English files chosen by `OUTPUT_LANGUAGE`. Every prompt a run loads is recorded as `<file>@<hash>` in the metrics JSON, the Job Summary and the note frontmatter. The Map phase's unused in-memory cache was removed.

## Changes Made
- [src/summarization/prompts.ts](../../../src/summarization/prompts.ts): `loadPrompt()`; inline prompts removed.
- [prompts/manifest.json](../../../prompts/manifest.json), [prompts/](../../../prompts/): `reduce_{ja,en}_v1.md`, `*_reduce_en_v1.md` added, Japanese periodic files renamed `*_reduce_ja_v1.md`.
- [src/core/language.ts](../../../src/core/language.ts): output language resolution shared by the daily and periodic runs.
- [src/core/metrics.ts](../../../src/core/metrics.ts), [src/storage/markdown_builder.ts](../../../src/storage/markdown_builder.ts), [src/main.ts](../../../src/main.ts): prompt recording.
- [src/aggregation/](../../../src/aggregation/), [src/cli/report.ts](../../../src/cli/report.ts), periodic workflows: language-aware periodic reports.
- [src/summarization/gemini_map.ts](../../../src/summarization/gemini_map.ts): `factCache` removed.
- Docs: `AGENTS.md`, `docs/settings.md`, `docs/architecture.md`, `docs/improvement-plan.md`.

## Verification Results
| Stage | Command | Result |
| :--- | :--- | :--- |
| Type check | `npm run type-check` | ✅ |
| Lint / format | `npm run lint && npm run format:check` | ✅ |
| Config | `npm run test:config` | ✅ |
| Tests + coverage | `npm run test:coverage` | ✅ 48 suites / 353 tests |
| Golden | `npm run test:golden` | ✅ 5 tests |
| Build | `npm run build` | ✅ |
| Workflows | `actionlint` v1.7.12 | ✅ |
| Plan-first | `npm run change-dev:plan-check` | ✅ |

Not verified: a live LLM run (no API keys in the session).
