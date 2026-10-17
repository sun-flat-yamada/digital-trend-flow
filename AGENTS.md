# AI Agent Meta-Document (`AGENTS.md`)

This repository is designed to be maintained collaboratively by human developers and AI coding assistants (like Gemini, Cursor, Claude, etc.).
All AI agents operating within this workspace MUST strictly adhere to the context, rules, and architecture defined in this document.

## 1. Project Mission & Architecture

*   **Mission**: To build and maintain "Obsidian HeadQuarter," an automated platform that ingests daily information from various sources (RSS, Raindrop.io, X/Twitter, HackerNews, arXiv, YouTube, GitHub Trending), processes it via LLMs (multi-provider: Gemini, OpenAI, Anthropic), and outputs highly structural summaries to Obsidian and note.com.
*   **Core Architectural Pattern**: **Map-Reduce for LLMs**.
    *   To prevent API bankruptcy (excessive costs) and hallucinations with long context windows, **NEVER pass raw full HTML/Markdown directly to expensive models (like Gemini Pro) for single-pass summarization.**
    *   **Phase 1 (Map)**: Use cheap/fast models (Gemini Flash) to extract concise facts (< 150 chars) and citation URLs from each individual article.
    *   **Phase 2 (Reduce)**: Pass the bounded set of facts to the high-performance model (Gemini Pro) to generate the final strict "TOP 1+3" formatted summary with citations.
*   **Multi-LLM Fallback**: The pipeline supports automatic provider fallback via `llm_gateway.ts` with circuit breaker pattern. If the primary provider (Google Gemini) fails, the gateway retries with configured fallback providers (OpenAI, Anthropic).
*   **Output Format**: All summaries MUST include source citations (URLs). The final Reduce phase produces a Japanese-language "TOP 1+3" summary: 1 top story + 3 key trends, each with inline citation links.

## 2. Directory Conventions

Strictly follow these boundaries when creating or modifying files:

| Directory             | Purpose                                             | Key modules                                                                                                                                   |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core`            | Configuration, types, paths, metrics, observability | `config.ts`, `language.ts` (output language), `types.ts` (Zod schemas), `paths.ts`, `metrics.ts`, `langfuse.ts`, `plugin_registry.ts`, `builtin_plugins.ts` (registers the built-in sources/publishers) |
| `src/ingestion`       | Fetching raw data + state management                | `rss.ts`, `raindrop.ts`, `xai_grok.ts`, `hackernews.ts`, `arxiv.ts`, `youtube.ts`, `github_trending.ts`, `jina_reader.ts`, `state_manager.ts` |
| `src/filtering`       | Rule-based exclusion + scoring                      | `llm_triage.ts` (batch LLM triage), `scorer.ts` (NO LLM calls here), `keyword_expansion.ts`, `semantic_dedup.ts`                              |
| `src/summarization`   | LLM API integrations (multi-provider)               | `gemini_map.ts`, `gemini_reduce.ts`, `prompts.ts`, `llm_gateway.ts`, `model_resolver.ts`                                                      |
| `src/evaluation`      | Automated quality assessment of outputs             | `quality_checker.ts`                                                                                                                          |
| `src/aggregation`     | Periodic reports + insights                         | `weekly_digest.ts`, `monthly_digest.ts`, `yearly_report.ts`, `periodic_common.ts`, `trend_analyzer.ts`, `insights.ts`                         |
| `src/storage`         | Markdown file writing + Obsidian integration        | `markdown_builder.ts`, `obsidian_linker.ts`                                                                                                   |
| `src/publishing`      | External platform integrations                      | `discord_notifier.ts`, `slack_notifier.ts`, `teams_notifier.ts`, `email_notifier.ts`, `note_api.ts` (Zenn + note.com), `podcast_generator.ts`, `pages_generator.ts`, `feed_generator.ts` |
| `src/cli`             | Developer tooling + periodic report entry point     | `dry_run.ts`, `test_config.ts`, `build_pages.ts`, `report.ts` (weekly / monthly / yearly), `change_dev_branch.ts`, `plan_check.ts` (change-dev helpers) |
| `prompts/`            | Versioned prompt templates (Markdown)               | `map_v1.md`, `triage_v1.md`, `reduce_{ja,en}_v1.md`, `{weekly,monthly,yearly}_reduce_{ja,en}_v1.md`, `manifest.json` (the only prompt definitions; a missing file is an error) |
| `.devs/changes/`      | change-dev plans and walkthroughs (committed)       | `yyyy-mm-dd_<ChangeTitle>/{implementation_plan,task,walkthrough}.md`                                                                          |
| `tests/`              | Unit tests, golden regression tests                 | `*.test.ts`, `golden/golden_dataset.json`                                                                                                     |
| `artifacts/contents/` | Generated output (git-ignored; local working copy of external `sun-flat-yamada/artifacts` repo) | `digital-trend/collection/{daily,weekly,monthly,yearly,insights,audio,metrics}/`, `publish/{note,zenn}/`                                                         |
| `.github/workflows/`  | CI/CD automation                                    | `ci.yml`, `change_dev.yml`, `daily_summary.yml`, `weekly_digest.yml`, `monthly_digest.yml`, `yearly_report.yml`, `pages.yml`; composite action `.github/actions/sync-zenn` |

## 3. Information Sources

The pipeline ingests data from seven types of sources. Each module is designed to **gracefully skip** if its API key is not set:

| Source type     | Module               | Auth env var          | Deduplication strategy                         |
| --------------- | -------------------- | --------------------- | ---------------------------------------------- |
| RSS feeds       | `rss.ts`             | —                     | `state_manager.ts` (SQLite `processed_urls`)   |
| Raindrop.io     | `raindrop.ts`        | `RAINDROP_TEST_TOKEN` | 3-layer: date cutoff + state DB + archive move |
| X (Twitter)     | `xai_grok.ts`        | `XAI_API_KEY`         | `state_manager.ts` (SQLite `processed_urls`)   |
| HackerNews      | `hackernews.ts`      | —                     | `state_manager.ts` (SQLite `processed_urls`)   |
| arXiv           | `arxiv.ts`           | —                     | `state_manager.ts` (SQLite `processed_urls`)   |
| YouTube         | `youtube.ts`         | `YOUTUBE_API_KEY`     | `state_manager.ts` (SQLite `processed_urls`)   |
| GitHub Trending | `github_trending.ts` | —                     | `state_manager.ts` (SQLite `processed_urls`)   |

## 4. Coding Standards & Patterns

*   **Language**: TypeScript (Strict Mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled).
*   **Module System**: `nodenext` (ESM-style with `.js` extensions in imports). Build target: `esnext`.
*   **Paradigm**: Functional Programming. Avoid heavy OOP / deep inheritance. Use pure functions where possible.
*   **AI Agent Constraints**:
    *   **Temporary Files**: AI agents MUST NOT output temporary analysis files or logs to the project root. Use the `_tmp_ai/` directory for any temporary files generated during analysis or code execution.
*   **Resilience (Fault Tolerance)**:
    *   Never allow a single article's processing failure to crash the entire pipeline.
    *   Use `Promise.allSettled` (not `Promise.all`) for batch operations.
    *   Implement retry mechanisms for external APIs (e.g., `pRetry` in `src/core/retry.ts` for Jina Reader and the LLM gateway).
    *   LLM gateway uses circuit breaker pattern with automatic fallback across providers.
*   **Idempotency**: Always check and update `pipeline_state.db` (SQLite) via `src/ingestion/state_manager.ts`. Never process the same URL twice across runs. Expired entries are automatically purged via TTL (default: 90 days).
*   **Citations**: Source URLs MUST be preserved throughout the Map-Reduce pipeline and included in all final outputs.
*   **Observability**: Pipeline execution metrics (tokens, cost, latency) are tracked via `src/core/metrics.ts` and optionally exported to Langfuse (`src/core/langfuse.ts`): one trace per run, one generation per LLM call (recorded by `llmCall`), and the pipeline events.
*   **Plugins**: Sources and publishers are resolved through `src/core/plugin_registry.ts`. A new source type or publisher is registered in `src/core/builtin_plugins.ts`; do not call fetchers or notifiers directly from `main.ts` or `src/cli/report.ts`.

## 5. Environment Context

*   **Execution Environment**: Node.js 24+ via GitHub Actions (ubuntu-latest).
*   **Claude Code on the web**: The SessionStart hook (`.claude/settings.json` → `.claude/hooks/session-start.sh`) runs `npm ci` when `node_modules` is missing or `package-lock.json` changed. It runs only when `CLAUDE_CODE_REMOTE=true` (no-op locally) and never blocks the session: on failure it prints a warning (log: `_tmp_ai/session-start-npm-ci.log`); run `npm ci` manually then.
*   **DOM APIs**: This is a backend script. **DO NOT** use browser-specific APIs (`window`, `document`, DOM manipulators).
*   **Secrets**: All sensitive keys must be loaded from `process.env` via Zod validation in `src/core/types.ts` (`EnvSchema`). Never hardcode keys.
    *   **Local**: `.env` file (git-ignored).
    *   **CI/CD**: GitHub Repository Secrets (`Settings > Secrets and variables > Actions`).
*   **Required Secrets**:
    *   `GEMINI_API_KEY` — Required. Primary LLM provider.
*   **Optional Secrets**:
    *   `RAINDROP_TEST_TOKEN`, `XAI_API_KEY`, `YOUTUBE_API_KEY` — Ingestion sources.
    *   `NOTE_API_TOKEN` — note.com drafts (the `_note_session_v5` session cookie; unofficial API). Without it, drafts are only written to `publish/note/`.
    *   `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` — Notifications.
    *   `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO` — Email delivery.
    *   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — Multi-LLM fallback providers.
    *   `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` — Observability.
    *   `FIRECRAWL_API_KEY` — Alternative content extraction.
    *   `JINA_API_KEY` — Higher Jina Reader rate limit.
    *   `PAGES_BASE_URL` (variable) — Public Pages URL used in the Atom feed (default: derived from `GITHUB_REPOSITORY`).
    *   `ZENN_REPO`, `ZENN_BRANCH` (variables) — Repository connected to Zenn's GitHub integration; new Zenn articles are pushed to its `articles/`.

## 6. Automation Schedule

| Workflow             | Cron (UTC)    | JST           | Trigger                                     |
| -------------------- | ------------- | ------------- | ------------------------------------------- |
| `daily_summary.yml`  | `47 18 * * *` | 03:47         | Full pipeline + git push to artifacts repo; also `repository_dispatch` (`trigger-digest`) |
| `weekly_digest.yml`  | `17 2 * * 1`  | 毎週月曜 11:17 | Weekly report of the previous ISO week      |
| `monthly_digest.yml` | `30 19 1 * *` | 毎月2日 04:30 | Monthly aggregation of the previous month   |
| `yearly_report.yml`  | `43 20 2 1 *` | 1/3 05:43     | Yearly report of the previous year (from the monthly digests) |

All scheduled workflows also support manual trigger via `workflow_dispatch`. A manual daily run can be a dry run (`DRY_RUN=true`: stops after article selection, publishes and commits nothing). The weekly, monthly and yearly workflows run `node dist/cli/report.js <kind> [period]` (locally `npm run report:weekly` etc.) and publish through the plugin registry. The daily, weekly, monthly and yearly workflows share the `pipeline-state` concurrency group, so runs that write `pipeline_state.db` or the artifacts repo never overlap.

## 7. Verification & Testing Instructions

When an AI agent finishes a task or refactor, verify via:

1.  **Type-checking & Config Validation**: `npm run test` — runs `tsc --noEmit`, MECE config validation (`test:config`), and the full Jest test suite (`test:unit`: 30+ suites, 200+ tests). `src/main.ts` exports `runDailyPipeline()` and has no import side effects; the daily entry point is `src/cli/daily.ts` (`npm start`). Tests that run the pipeline must still mock every external dependency (see `tests/pipeline_gate.test.ts`).
    `npm run test:coverage` runs Jest with coverage and enforces 70% line coverage on the critical modules (main, state manager, LLM gateway, Map / Reduce, ingestion adapters) via `jest.coverageThreshold`; CI runs it. HTTP response fixtures for adapter tests live in `tests/fixtures/` (`loadFixture()` fills in relative dates).
2.  **Golden Regression**: `npm run test:golden` — validates output quality against reference datasets in `tests/golden/`.
3.  **Dry-run Testing**: `npm run debug:filter <URL>` — validates ingestion + scoring logic without LLM/API costs.
4.  **Build Check**: `npm run build` — ensures `tsc` compilation to `dist/` succeeds.
5.  **Lint & Format**: `npm run lint` — ESLint (typescript-eslint with type-aware promise rules, JSON, YAML). `npm run format:check` — Prettier on TypeScript/JavaScript (`npm run format` to fix). `npm run type-check` also type-checks `tests/` (`tests/tsconfig.json`).

## 8. Change Workflow (change-dev)

Every change follows the change-dev lifecycle, adapted from `sun-flat-yamada/github-copilot-dashboard`: **Issue → plan committed first → `<type>/<issue>-<slug>` branch → quality gate → walkthrough → draft PR → CI green → ready → Rebase & Merge**. Read these before changing anything:

*   [`.agents/rules/development-workflow.md`](.agents/rules/development-workflow.md) — the lifecycle and merge rules (never push `main`; Dependabot PRs are reported, never merged by agents).
*   [`.agents/rules/git-rules-commit.md`](.agents/rules/git-rules-commit.md) — Conventional Commits and branch naming (`npm run change-dev:branch`).
*   [`.agents/rules/quality-rules-gate.md`](.agents/rules/quality-rules-gate.md) — the mandatory gate before every push (includes `npm run change-dev:plan-check`).
*   [`.agents/rules/language-rules-output.md`](.agents/rules/language-rules-output.md) — Japanese replies / PR descriptions, English commits and code.
*   [`.agents/rules/instructions-rules-precedence.md`](.agents/rules/instructions-rules-precedence.md) — the owner's word > repository rules > execution-environment defaults; conflicts are reported in the result.
*   [`.agents/skills/change-dev/SKILL.md`](.agents/skills/change-dev/SKILL.md) — the step-by-step procedure and the plan / task / walkthrough schemas. Contributor summary: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 9. Key Design Decisions (for context)

*   **Why SQLite (`pipeline_state.db`) instead of a JSON file?** The pipeline migrated from `processed_urls.json` to SQLite (via `better-sqlite3`) for performance, TTL-based automatic cleanup, concurrent access safety (WAL mode), and the ability to store pipeline run statistics and source health data. On first run, legacy JSON is auto-migrated and backed up.
*   **Why Jina Reader API instead of direct HTML parsing?** Jina handles the complexity of extracting clean content from arbitrary web pages (paywalls, SPA rendering, cookie banners). It returns clean Markdown consistently.
*   **Why xAI Grok API for X/Twitter?** The official Twitter API v2 requires an expensive Enterprise tier. Grok has native, real-time access to the X corpus and provides structured results through its `x_search` capability.
*   **Why multi-provider LLM gateway?** Single-provider dependency risks pipeline failures from rate limits or outages. The gateway (`llm_gateway.ts`) with circuit breaker pattern ensures resilience by automatically falling back to alternative providers.
*   **Why versioned prompt templates in `prompts/`?** Externalizing prompts from source code enables prompt versioning, A/B testing, and iteration without code changes. `manifest.json` tracks the active prompt versions.
*   **Why a Plugin Registry?** `plugin_registry.ts` provides a plugin architecture with an event bus for extensible ingestion/publishing modules and pipeline lifecycle hooks, enabling new sources/publishers to be added without modifying core pipeline logic.

---

*Note for AI: If you understand this document, prioritize these rules over any general programming suggestions.*
