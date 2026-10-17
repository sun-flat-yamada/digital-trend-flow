# Make prompts/ the single prompt source and record the prompts used (#44)

Prompts are defined twice (`prompts/*.md` and inline in `src/summarization/prompts.ts`), a missing file silently falls back to the inline copy, `promptHash` is unused, and the weekly / monthly / yearly prompts are Japanese only. The Map phase's in-memory `factCache` never hits (LLM-7).

## User Review Required
> [!IMPORTANT]
> The weekly, monthly and yearly reports will follow `OUTPUT_LANGUAGE` like the daily summary (Issue #44). The periodic workflows will pass `vars.OUTPUT_LANGUAGE || 'en'`, so **without the variable the periodic reports switch from Japanese to English**. Set `vars.OUTPUT_LANGUAGE=ja` to keep them Japanese.

> [!WARNING]
> A missing prompt file or manifest entry becomes an error instead of a silent fallback: Map fails per article, Reduce falls back to the raw-facts document (degraded run), periodic reports fail the job.

## Proposed Changes
### Prompts
#### [MODIFY] [prompts/manifest.json](../../../prompts/manifest.json)
- `reduce` becomes a file per language; periodic entries become `{ja, en}`.
#### [NEW] [prompts/reduce_ja_v1.md](../../../prompts/reduce_ja_v1.md), [prompts/reduce_en_v1.md](../../../prompts/reduce_en_v1.md)
- The daily Reduce prompt, with `{{purpose_sections}}` and `{{language_instruction}}`; rendered text unchanged.
#### [NEW] [prompts/weekly_reduce_en_v1.md](../../../prompts/weekly_reduce_en_v1.md) (and monthly / yearly)
- English versions with `{{language_instruction}}`; the Japanese files are renamed `*_reduce_ja_v1.md`.
#### [MODIFY] [src/summarization/prompts.ts](../../../src/summarization/prompts.ts)
- `loadPrompt(key, language, vars)`: file only, throws on a missing entry / file / placeholder value, records `<file>@<hash>`. Inline prompts removed.
### Recording
#### [MODIFY] [src/core/metrics.ts](../../../src/core/metrics.ts)
- `prompts` map in the run metrics and a Prompts row in the Job Summary.
#### [MODIFY] [src/storage/markdown_builder.ts](../../../src/storage/markdown_builder.ts)
- `prompts` in the frontmatter; daily (`main.ts`) and periodic reports pass it.
### Language
#### [NEW] [src/core/language.ts](../../../src/core/language.ts)
- `outputLanguage()` (OUTPUT_LANGUAGE → SUMMARY_LANGUAGE → settings.language) and `isJapanese()`.
#### [MODIFY] weekly / monthly / yearly generators, `periodic_common.ts`, `cli/report.ts`, the three periodic workflows
- Choose the prompt and the trend-section heading by language.
### Cleanup
#### [MODIFY] [src/summarization/gemini_map.ts](../../../src/summarization/gemini_map.ts)
- Remove `factCache` / `clearFactCache`.
### Docs
- `AGENTS.md`, `docs/settings.md`, `docs/architecture.md`, `docs/improvement-plan.md` (2-5, LLM-7, LLM-8).

## Verification Plan
### Automated Tests
- Quality gate, `npm run test:golden`, actionlint.
- `tests/prompts.test.ts`: manifest/file parity, no placeholder left, language selection, hash recording, error paths.
- `tests/periodic_reports.test.ts`: ja and non-ja report, frontmatter `prompts`.
- `tests/markdown_builder.test.ts`, `tests/metrics.test.ts`: frontmatter and Job Summary.
### Manual Verification
- None (no LLM keys in the session).
