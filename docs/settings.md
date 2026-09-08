# Settings & Rate Limiting Guide (`docs/settings.md`)

This document provides a comprehensive reference for runtime execution settings, rate limiting, retry policies, and GitHub Variables override options in **Digital Trend Flow**.

---

## 1. Overview

LLM API providers (such as Google Gemini, OpenAI, and Anthropic) enforce rate limits (Requests Per Minute / RPM, Tokens Per Minute / TPM). In particular, the Google Gemini **Free Tier** limits requests to **5 RPM** for models like `gemini-3.8-flash`.

To guarantee reliable pipeline execution without hitting `429 Too Many Requests` or tripping the circuit breaker into fallback mode, Digital Trend Flow implements:
1. **Configurable Concurrency (`API_CONCURRENCY`)**
2. **Inter-request Rate Limiting Interval (`API_INTERVAL_MS`)**
3. **Automated Exponential Backoff Retries (`p-retry`)** with dynamic upstream delay parsing
4. **Separation of Rate Limits from Service Outages** in the Circuit Breaker

---

## 2. Core Execution Settings

All execution settings define safe defaults out of the box and can be overridden via **GitHub Actions Repository Variables**, local `.env` variables, or `config.yml`.

| Variable / Setting | Source | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `API_CONCURRENCY` | Env / GitHub Variable | Integer | `1` | Number of concurrent requests executed in parallel during Phase 3 (LLM Map fact extraction). |
| `API_INTERVAL_MS` | Env / GitHub Variable | Integer | `13000` | Delay in milliseconds inserted between processing iterations (13,000ms ≈ 4.6 RPM, safely below 5 RPM). |
| `OUTPUT_LANGUAGE` | Env / GitHub Variable | String | `en` | Output language for summarization and GitHub Pages publication. Defaults to English (`en`). |
| `SUMMARY_LANGUAGE`| Env / GitHub Variable | String | (optional) | Alias for `OUTPUT_LANGUAGE` to control the pipeline's output language. |
| `settings.language` | `config.yml` | String | `en` | Output language defined in repository configuration. Overridden by `OUTPUT_LANGUAGE` / `SUMMARY_LANGUAGE` if set. |

---

## 3. Language Selection & Output Control

Digital Trend Flow supports configurable output language selection. By default, the system generates summaries and publishes the GitHub Pages static site in **English (`en`)**.

### Priority Resolution
The output language is resolved in the following priority order:
1. `OUTPUT_LANGUAGE` environment / GitHub Actions variable
2. `SUMMARY_LANGUAGE` environment / GitHub Actions variable
3. `settings.language` in `config.yml`
4. Fallback default: `"en"`

### Controlled Pipeline Stages

When a language is specified, the following components automatically adapt:

1. **Summarization Prompt (`src/summarization/prompts.ts`)**:
   - **`en` (Default)**: Produces an English briefing with `## 🔥 Today's Top Story`, `**Source**: [Title](URL)`, structured sections (`Technical Breakthrough`, `Trade-offs & Adoption Considerations`, `Recommended Actions for Engineers`), active category breakdowns, and `## 📰 Other Relevant News`.
   - **`ja`**: Produces a Japanese briefing with `## 🔥 本日の最重要ニュース`, `**出典**:`, `技術的ブレークスルー`, `採用・導入のトレードオフ`, `エンジニアへの推奨アクション`, and `## 📰 その他の関連ニュース`.
   - **Any other language (`es`, `fr`, `de`, `zh`, etc.)**: Dynamically instructs the LLM to write the entire briefing fluently in the requested language while strictly adhering to the "TOP 1+3" section structure.

2. **Quality Evaluation (`src/evaluation/quality_checker.ts`)**:
   - Validates that the generated summary matches the target language (e.g. Latin/English character ratio for `en`, Japanese character ratio for `ja`).
   - Checks for actionable insight and required section headers in both English and Japanese.

3. **GitHub Pages Static Site (`src/publishing/pages_generator.ts`)**:
   - Updates HTML document language tag (`<html lang="en">` or `<html lang="ja">`).
   - Localizes UI elements: navigation tabs (`📅 Calendar` / `📋 Archive List`), calendar weekdays and month headers, search placeholders, headline badges, article counter badges, copy link notifications, and 404 error page.
   - Parses both `**Source**:` and `**出典**:` citation links.

4. **Frontmatter & Markdown Storage (`src/storage/markdown_builder.ts`)**:
   - Serializes `language: en` in the Markdown YAML frontmatter.
   - Adjusts Obsidian backlink anchor text (`[[...|Previous Summary]]` for English vs. `[[...|前日のサマリー]]` for Japanese).

### Common Language Values
* `en` or `English` — English (Default)
* `ja` or `Japanese` — Japanese
* Any custom language name (e.g., `es`, `fr`, `de`, `zh`, `ko`)

---

## 4. Recommended Profiles

### A. Gemini Free Tier Profile (Default)
When using a Free Tier Gemini API key (`GEMINI_API_KEY`):
* **`API_CONCURRENCY`**: `1`
* **`API_INTERVAL_MS`**: `13000` (13 seconds)
* **`OUTPUT_LANGUAGE`**: `en` (or `ja` if Japanese output is desired)
* **Behavior**: Articles are processed sequentially with a 13-second pause between calls, strictly keeping request frequency under the 5 RPM ceiling.

### B. Paid Tier Profile (Pay-As-You-Go)
When a billing account is linked in Google AI Studio (increasing quota to 1,000+ RPM) or using OpenAI/Anthropic:
* **`API_CONCURRENCY`**: `5` (or higher)
* **`API_INTERVAL_MS`**: `0` (or `500`)
* **`OUTPUT_LANGUAGE`**: `en`
* **Behavior**: Processes multiple articles in parallel, dramatically reducing total workflow execution time from ~3 minutes to under 30 seconds.

---

## 5. How to Configure Overrides in GitHub Actions

You can customize these parameters directly in your GitHub repository without modifying code or committing configuration changes.

### Steps to set GitHub Variables:
1. Navigate to your repository on GitHub: `https://github.com/<owner>/<repo>`.
2. Go to **Settings** > **Secrets and variables** > **Actions**.
3. Select the **Variables** tab (next to Secrets).
4. Click **New repository variable**.
5. Add variables as needed:
   - **Name**: `API_CONCURRENCY` / **Value**: e.g., `5`
   - **Name**: `API_INTERVAL_MS` / **Value**: e.g., `0`
   - **Name**: `OUTPUT_LANGUAGE` / **Value**: e.g., `en` (or `ja` for Japanese)
6. Click **Add variable**.

The scheduled workflow (`daily_summary.yml`), static site workflow (`pages.yml`), and manual workflow (`on_demand.yml`) automatically bind these variables into the execution environment:
```yaml
env:
  API_CONCURRENCY: ${{ vars.API_CONCURRENCY }}
  API_INTERVAL_MS: ${{ vars.API_INTERVAL_MS }}
  OUTPUT_LANGUAGE: ${{ vars.OUTPUT_LANGUAGE || 'en' }}
  SUMMARY_LANGUAGE: ${{ vars.SUMMARY_LANGUAGE || '' }}
```

---

## 6. Exponential Backoff & Retry Policy

All calls to LLM providers routed through `src/summarization/llm_gateway.ts` utilize `p-retry` with the following configuration:

* **Maximum Retries**: `3` attempts per provider.
* **Backoff Factor**: `2` (exponential: e.g., 2s, 4s, 8s).
* **Min Timeout**: `2,000 ms`.
* **Max Timeout**: `65,000 ms`.
* **Upstream Delay Parsing**: If Gemini or another provider returns a specific retry advice (e.g., `Please retry in 32.197s` or `retry-after` header), the gateway automatically pauses for that exact duration before the next retry attempt.
* **Non-Retryable Client Errors**: HTTP `400` (Bad Request), `401` (Unauthorized / Invalid Key), and `403` (Forbidden) abort retrying immediately (`AbortError`) to avoid redundant API requests.

---

## 7. Circuit Breaker & Fault Isolation

To prevent temporary rate-limiting from shutting down the entire pipeline, the circuit breaker distinguishes between **Rate Limits** and **Infrastructure Outages**:

1. **Rate Limit Errors (`429`, `RESOURCE_EXHAUSTED`, `Quota exceeded`)**:
   - Treated as temporary throttling, **NOT** as a platform outage.
   - Do **NOT** increment the 5-minute outage circuit breaker.
   - Retries with exponential backoff; if retries are exhausted, falls back to alternative providers (if configured) without locking out subsequent phases like Phase 4 (Reduce summarization).
2. **Infrastructure Failures (`500`, `502`, `503`, network disconnects)**:
   - If 3 consecutive requests fail across all retries (`CIRCUIT_THRESHOLD = 3`), the circuit breaker opens (`isOpen = true`).
   - Requests to that provider are skipped during the 5-minute cooldown (`CIRCUIT_COOLDOWN_MS = 300,000 ms`) before probing again.
3. **Success Reset**:
   - Any successful API response resets the provider's failure counter to 0.

---

## 8. Web Content Extraction Throttling

Phase 2 (Content Extraction via Jina Reader in `src/main.ts`) operates independently of LLM API quotas:
- Concurrency defaults to `Math.max(env.API_CONCURRENCY, 3)`.
- Request interval is set to `200 ms` to maintain fast scraping throughput without overloading target web servers.
