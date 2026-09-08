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

All execution settings define safe defaults out of the box and can be overridden via **GitHub Actions Repository Variables** or local `.env` variables.

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `API_CONCURRENCY` | Integer | `1` | Number of concurrent requests executed in parallel during Phase 3 (LLM Map fact extraction). |
| `API_INTERVAL_MS` | Integer | `13000` | Delay in milliseconds inserted between processing iterations (13,000ms ≈ 4.6 RPM, safely below 5 RPM). |

---

## 3. Recommended Profiles

### A. Gemini Free Tier Profile (Default)
When using a Free Tier Gemini API key (`GEMINI_API_KEY`):
* **`API_CONCURRENCY`**: `1`
* **`API_INTERVAL_MS`**: `13000` (13 seconds)
* **Behavior**: Articles are processed sequentially with a 13-second pause between calls, strictly keeping request frequency under the 5 RPM ceiling.

### B. Paid Tier Profile (Pay-As-You-Go)
When a billing account is linked in Google AI Studio (increasing quota to 1,000+ RPM) or using OpenAI/Anthropic:
* **`API_CONCURRENCY`**: `5` (or higher)
* **`API_INTERVAL_MS`**: `0` (or `500`)
* **Behavior**: Processes multiple articles in parallel, dramatically reducing total workflow execution time from ~3 minutes to under 30 seconds.

---

## 4. How to Configure Overrides in GitHub Actions

You can customize these parameters directly in your GitHub repository without modifying code or committing configuration changes.

### Steps to set GitHub Variables:
1. Navigate to your repository on GitHub: `https://github.com/<owner>/<repo>`.
2. Go to **Settings** > **Secrets and variables** > **Actions**.
3. Select the **Variables** tab (next to Secrets).
4. Click **New repository variable**.
5. Add variables as needed:
   - **Name**: `API_CONCURRENCY` / **Value**: e.g., `5`
   - **Name**: `API_INTERVAL_MS` / **Value**: e.g., `0`
6. Click **Add variable**.

The scheduled workflow (`daily_summary.yml`) and manual workflow (`on_demand.yml`) automatically bind these variables into the execution environment:
```yaml
env:
  API_CONCURRENCY: ${{ vars.API_CONCURRENCY }}
  API_INTERVAL_MS: ${{ vars.API_INTERVAL_MS }}
```

---

## 5. Exponential Backoff & Retry Policy

All calls to LLM providers routed through `src/summarization/llm_gateway.ts` utilize `p-retry` with the following configuration:

* **Maximum Retries**: `3` attempts per provider.
* **Backoff Factor**: `2` (exponential: e.g., 2s, 4s, 8s).
* **Min Timeout**: `2,000 ms`.
* **Max Timeout**: `65,000 ms`.
* **Upstream Delay Parsing**: If Gemini or another provider returns a specific retry advice (e.g., `Please retry in 32.197s` or `retry-after` header), the gateway automatically pauses for that exact duration before the next retry attempt.
* **Non-Retryable Client Errors**: HTTP `400` (Bad Request), `401` (Unauthorized / Invalid Key), and `403` (Forbidden) abort retrying immediately (`AbortError`) to avoid redundant API requests.

---

## 6. Circuit Breaker & Fault Isolation

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

## 7. Web Content Extraction Throttling

Phase 2 (Content Extraction via Jina Reader in `src/main.ts`) operates independently of LLM API quotas:
- Concurrency defaults to `Math.max(env.API_CONCURRENCY, 3)`.
- Request interval is set to `200 ms` to maintain fast scraping throughput without overloading target web servers.
