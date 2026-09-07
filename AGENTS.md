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
| `src/core`            | Configuration, types, paths, metrics, observability | `config.ts`, `types.ts` (Zod schemas), `paths.ts`, `metrics.ts`, `langfuse.ts`, `plugin_registry.ts`                                          |
| `src/ingestion`       | Fetching raw data + state management                | `rss.ts`, `raindrop.ts`, `xai_grok.ts`, `hackernews.ts`, `arxiv.ts`, `youtube.ts`, `github_trending.ts`, `jina_reader.ts`, `state_manager.ts` |
| `src/filtering`       | Rule-based exclusion + scoring                      | `scorer.ts` (NO LLM calls here), `keyword_expansion.ts`, `semantic_dedup.ts`                                                                  |
| `src/summarization`   | LLM API integrations (multi-provider)               | `gemini_map.ts`, `gemini_reduce.ts`, `prompts.ts`, `llm_gateway.ts`, `model_resolver.ts`                                                      |
| `src/evaluation`      | Automated quality assessment of outputs             | `quality_checker.ts`                                                                                                                          |
| `src/storage`         | Markdown file writing + Obsidian integration        | `markdown_builder.ts`, `obsidian_linker.ts`                                                                                                   |
| `src/publishing`      | External platform integrations                      | `discord_notifier.ts`, `slack_notifier.ts`, `teams_notifier.ts`, `note_api.ts`, `feed_generator.ts`                                           |
| `src/cli`             | Developer tooling                                   | `dry_run.ts`, `test_config.ts`                                                                                                                |
| `prompts/`            | Versioned prompt templates (Markdown)               | `map_v1.md`, `judge_v1.md`, `monthly_reduce_v1.md`, `manifest.json`                                                                           |
| `tests/`              | Unit tests, golden regression tests                 | `*.test.ts`, `golden/golden_dataset.json`                                                                                                     |
| `artifacts/contents/` | Generated output (git-ignored; local working copy of external `sun-flat-yamada/artifacts` repo) | `digital-trend/collection/{daily,monthly,yearly,metrics}/`, `publish/{note,zenn}/`                                                            |
| `.github/workflows/`  | CI/CD automation                                    | `daily_summary.yml`, `monthly_digest.yml`, `yearly_report.yml`, `on_demand.yml`                                                               |

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
    *   Implement retry mechanisms for external APIs (e.g., `p-retry` for Jina Reader).
    *   LLM gateway uses circuit breaker pattern with automatic fallback across providers.
*   **Idempotency**: Always check and update `pipeline_state.db` (SQLite) via `src/ingestion/state_manager.ts`. Never process the same URL twice across runs. Expired entries are automatically purged via TTL (default: 90 days).
*   **Citations**: Source URLs MUST be preserved throughout the Map-Reduce pipeline and included in all final outputs.
*   **Observability**: Pipeline execution metrics (tokens, cost, latency) are tracked via `src/core/metrics.ts` and optionally exported to Langfuse (`src/core/langfuse.ts`).

## 5. Environment Context

*   **Execution Environment**: Node.js 24+ via GitHub Actions (ubuntu-latest).
*   **DOM APIs**: This is a backend script. **DO NOT** use browser-specific APIs (`window`, `document`, DOM manipulators).
*   **Secrets**: All sensitive keys must be loaded from `process.env` via Zod validation in `src/core/types.ts` (`EnvSchema`). Never hardcode keys.
    *   **Local**: `.env` file (git-ignored).
    *   **CI/CD**: GitHub Repository Secrets (`Settings > Secrets and variables > Actions`).
*   **Required Secrets**:
    *   `GEMINI_API_KEY` — Required. Primary LLM provider.
*   **Optional Secrets**:
    *   `RAINDROP_TEST_TOKEN`, `XAI_API_KEY`, `YOUTUBE_API_KEY` — Ingestion sources.
    *   `NOTE_API_TOKEN` — Publishing to note.com.
    *   `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` — Notifications.
    *   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — Multi-LLM fallback providers.
    *   `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` — Observability.
    *   `FIRECRAWL_API_KEY` — Alternative content extraction.

## 6. Automation Schedule

| Workflow             | Cron (UTC)    | JST           | Trigger                                     |
| -------------------- | ------------- | ------------- | ------------------------------------------- |
| `daily_summary.yml`  | `0 19 * * *`  | 04:00         | Full pipeline + git push to artifacts repo  |
| `monthly_digest.yml` | `30 19 1 * *` | 毎月1日 04:30 | Monthly aggregation from daily summaries    |
| `yearly_report.yml`  | `0 20 1 1 *`  | 1/1 05:00     | Yearly aggregation (placeholder)            |
| `on_demand.yml`      | —             | —             | `repository_dispatch` / `workflow_dispatch` |

All scheduled workflows also support manual trigger via `workflow_dispatch`.

## 7. Verification & Testing Instructions

When an AI agent finishes a task or refactor, verify via:

1.  **Type-checking & Config Validation**: `npm run test` — runs `tsc --noEmit`, MECE config validation (`test:config`), and the full Jest test suite (`test:unit`: 11 suites, 75+ tests).
2.  **Golden Regression**: `npm run test:golden` — validates output quality against reference datasets in `tests/golden/`.
3.  **Dry-run Testing**: `npm run debug:filter <URL>` — validates ingestion + scoring logic without LLM/API costs.
4.  **Build Check**: `npm run build` — ensures `tsc` compilation to `dist/` succeeds.
5.  **Lint**: `npm run lint` — ESLint check across TypeScript, JSON, and YAML files.

## 8. Key Design Decisions (for context)

*   **Why SQLite (`pipeline_state.db`) instead of a JSON file?** The pipeline migrated from `processed_urls.json` to SQLite (via `better-sqlite3`) for performance, TTL-based automatic cleanup, concurrent access safety (WAL mode), and the ability to store pipeline run statistics and source health data. On first run, legacy JSON is auto-migrated and backed up.
*   **Why Jina Reader API instead of direct HTML parsing?** Jina handles the complexity of extracting clean content from arbitrary web pages (paywalls, SPA rendering, cookie banners). It returns clean Markdown consistently.
*   **Why xAI Grok API for X/Twitter?** The official Twitter API v2 requires an expensive Enterprise tier. Grok has native, real-time access to the X corpus and provides structured results through its `x_search` capability.
*   **Why multi-provider LLM gateway?** Single-provider dependency risks pipeline failures from rate limits or outages. The gateway (`llm_gateway.ts`) with circuit breaker pattern ensures resilience by automatically falling back to alternative providers.
*   **Why versioned prompt templates in `prompts/`?** Externalizing prompts from source code enables prompt versioning, A/B testing, and iteration without code changes. `manifest.json` tracks the active prompt versions.
*   **Why a Plugin Registry?** `plugin_registry.ts` provides a plugin architecture with an event bus for extensible ingestion/publishing modules and pipeline lifecycle hooks, enabling new sources/publishers to be added without modifying core pipeline logic.

---

*Note for AI: If you understand this document, prioritize these rules over any general programming suggestions.*
