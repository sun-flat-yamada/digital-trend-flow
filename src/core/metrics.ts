/**
 * [Role] Pipeline execution metrics collection and cost tracking.
 * [Mechanism] Collects LLM call metrics (tokens, cost, latency) and pipeline
 * execution stats, then persists them for analysis and dashboard generation.
 *
 * Items: 4.1 LLM コスト追跡, 4.2 パイプライン実行メトリクス
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PATHS } from "./paths";
import { config } from "./config";
import { DEFAULT_PRICING, type ModelPrice } from "./types";

// ── LLM Call Metrics ──

export interface LLMCallMetrics {
  phase: "map" | "reduce" | "triage" | "keyword_expansion" | "trend_detection";
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  estimated_cost_usd: number;
}

// ── Pipeline Run Metrics ──

/** Outcome of a pipeline run. A "degraded" run is not published (see evaluation/run_gate.ts). */
export type RunStatus = "success" | "degraded" | "skipped" | "failed";

export interface SourceStatus {
  name: string;
  type: string;
  status: "ok" | "empty" | "error" | "disabled";
  article_count: number;
  error_message?: string;
  /** Consecutive runs (including this one) in which the source failed or returned nothing. */
  failure_streak?: number;
}

/** Streak length at which a source is listed under "Source Alerts" in the job summary. */
export const SOURCE_ALERT_STREAK = 3;

/** Batch LLM triage outcome (filtering/llm_triage.ts). "fallback" means the keyword pre-screen ran. */
export interface TriageMetrics {
  status: "ok" | "fallback" | "disabled";
  candidates: number;
  kept: number;
  dropped_irrelevant: number;
  dropped_duplicate: number;
  dropped_over_limit: number;
  batches: number;
  error?: string;
}

export interface PipelineRunMetrics {
  run_id: string;
  date: string;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  articles_ingested: number;
  /** New articles dropped before body extraction because a recent run already evaluated them. */
  articles_skipped_evaluated: number;
  articles_scored: number;
  articles_selected: number;
  articles_by_purpose: Record<string, number>;
  llm_calls: LLMCallMetrics[];
  total_tokens: { input: number; output: number };
  total_cost_usd: number;
  errors: string[];
  sources_status: SourceStatus[];
  /** Article body extraction: "fallback" means the source's description was used instead. */
  extraction: { attempted: number; failed: number; fallback: number };
  triage?: TriageMetrics;
  quality_score?: number;
  run_status?: RunStatus;
  status_reasons?: string[];
  map_attempted?: number; // selected articles sent to the Map phase
  map_succeeded?: number; // articles whose facts were extracted
  /** Prompts loaded by the run: prompt key → "<file>@<hash>" (see summarization/prompts.ts). */
  prompts?: Record<string, string>;
}

// ── Cost Estimation ──

/** The configured price table (`settings.pricing`), or the built-in one when config has none. */
function configuredPricing(): Record<string, ModelPrice> {
  return config.settings?.pricing ?? DEFAULT_PRICING;
}

/**
 * Estimates the cost of an LLM call from a price table (USD per 1M tokens), by default
 * `settings.pricing` in config.yml.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricingTable: Record<string, ModelPrice> = configuredPricing(),
): number {
  // Use the most specific (longest) matching key, so "gpt-4.1-mini" is not priced as "gpt-4.1".
  const name = model.toLowerCase();
  const pricing =
    Object.entries(pricingTable)
      .filter(([key]) => key !== "default" && name.includes(key.toLowerCase()))
      .reduce<[string, ModelPrice] | undefined>(
        (best, entry) => (best === undefined || entry[0].length > best[0].length ? entry : best),
        undefined,
      )?.[1] ??
    pricingTable["default"] ??
    DEFAULT_PRICING["default"]!;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

// ── Singleton Metrics Collector ──

class MetricsCollector {
  private metrics: PipelineRunMetrics;

  constructor() {
    const now = new Date();
    this.metrics = {
      run_id: crypto.randomUUID(),
      date: now.toISOString().split("T")[0] ?? "unknown",
      started_at: now.toISOString(),
      articles_ingested: 0,
      articles_skipped_evaluated: 0,
      articles_scored: 0,
      articles_selected: 0,
      articles_by_purpose: {},
      llm_calls: [],
      total_tokens: { input: 0, output: 0 },
      total_cost_usd: 0,
      errors: [],
      sources_status: [],
      extraction: { attempted: 0, failed: 0, fallback: 0 },
      prompts: {},
    };
  }

  /** Records a single LLM API call with its metrics. */
  recordLLMCall(call: LLMCallMetrics): void {
    this.metrics.llm_calls.push(call);
    this.metrics.total_tokens.input += call.input_tokens;
    this.metrics.total_tokens.output += call.output_tokens;
    this.metrics.total_cost_usd += call.estimated_cost_usd;
  }

  /** Records the prompt file and hash a run used for `key`. */
  recordPrompt(key: string, ref: string): void {
    (this.metrics.prompts ??= {})[key] = ref;
  }

  /** Records the status of a source fetch. */
  recordExtraction(outcome: "ok" | "failed" | "fallback"): void {
    const e = this.metrics.extraction;
    e.attempted++;
    if (outcome === "failed") e.failed++;
    if (outcome === "fallback") e.fallback++;
  }

  recordSourceStatus(status: SourceStatus): void {
    this.metrics.sources_status.push(status);
  }

  /** Records an error during pipeline execution. */
  recordError(error: string): void {
    this.metrics.errors.push(error);
  }

  /** Updates article counts at various pipeline stages. */
  setArticleCounts(ingested: number, scored: number, selected: number): void {
    this.metrics.articles_ingested = ingested;
    this.metrics.articles_scored = scored;
    this.metrics.articles_selected = selected;
  }

  /** Records how many new articles were dropped as already evaluated by a recent run. */
  setSkippedEvaluated(count: number): void {
    this.metrics.articles_skipped_evaluated = count;
  }

  /** Sets the per-purpose article distribution. */
  setArticlesByPurpose(distribution: Record<string, number>): void {
    this.metrics.articles_by_purpose = distribution;
  }

  /** Records the batch triage outcome. */
  setTriage(triage: TriageMetrics): void {
    this.metrics.triage = triage;
  }

  /** Sets the quality score from the quality checker. */
  setQualityScore(score: number): void {
    this.metrics.quality_score = score;
  }

  /** Records how many selected articles went through Map and how many yielded facts. */
  setMapResults(attempted: number, succeeded: number): void {
    this.metrics.map_attempted = attempted;
    this.metrics.map_succeeded = succeeded;
  }

  /** Records the run outcome and, for a non-success outcome, why. */
  setRunStatus(status: RunStatus, reasons: string[] = []): void {
    this.metrics.run_status = status;
    this.metrics.status_reasons = reasons;
  }

  /** Finalizes metrics and returns the complete record. */
  finalize(): PipelineRunMetrics {
    const now = new Date();
    this.metrics.finished_at = now.toISOString();
    this.metrics.duration_ms = now.getTime() - new Date(this.metrics.started_at).getTime();
    return this.metrics;
  }

  /**
   * Persists metrics to a JSON file in ARTIFACTS_METRICS/: `<date>_metrics.json` for a successful
   * run, `<date>_metrics.<status>.json` otherwise, so a later failed or skipped run on the same day
   * does not overwrite the record of the run that published.
   */
  persist(outputDir: string = PATHS.ARTIFACTS_METRICS.absolute): string {
    const absoluteDir = path.resolve(process.cwd(), outputDir);
    fs.mkdirSync(absoluteDir, { recursive: true });

    const status = this.metrics.run_status;
    const filename =
      status === undefined || status === "success"
        ? `${this.metrics.date}_metrics.json`
        : `${this.metrics.date}_metrics.${status}.json`;
    const filePath = path.join(absoluteDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(this.metrics, null, 2), "utf8");
    console.log(`📊 Metrics saved to: ${filePath}`);
    return filePath;
  }

  /** Generates a GitHub Actions step summary markdown. */
  toGitHubSummary(): string {
    const m = this.metrics;
    const mapCalls = m.llm_calls.filter((c) => c.phase === "map").length;
    const reduceCalls = m.llm_calls.filter((c) => c.phase === "reduce").length;
    const triageCalls = m.llm_calls.filter((c) => c.phase === "triage");
    const triageTokens = triageCalls.reduce(
      (sum, c) => ({ input: sum.input + c.input_tokens, output: sum.output + c.output_tokens }),
      { input: 0, output: 0 },
    );
    const triageCost = triageCalls.reduce((sum, c) => sum + c.estimated_cost_usd, 0);
    const t = m.triage;
    const triageRow = t
      ? `| Triage (${t.status}) | ${t.kept} kept / ${t.dropped_irrelevant} irrelevant / ${t.dropped_duplicate} duplicate / ${t.dropped_over_limit} over limit, of ${t.candidates}` +
        ` — tokens ${triageTokens.input.toLocaleString()} / ${triageTokens.output.toLocaleString()}, $${triageCost.toFixed(4)}` +
        (t.error ? ` — ${t.error.replace(/\s+/g, " ").slice(0, 200)}` : "") +
        " |\n"
      : "";

    const sourceRows = m.sources_status
      .map((s) => `| ${s.name} | ${s.type} | ${s.status} | ${s.article_count} | ${s.failure_streak ?? "—"} |`)
      .join("\n");
    const alertedSources = m.sources_status.filter(
      (s) => s.status === "error" || (s.failure_streak ?? 0) >= SOURCE_ALERT_STREAK,
    );
    const sourceAlertsSection =
      alertedSources.length > 0
        ? `\n### 🚨 Source Alerts\n${alertedSources
            .map(
              (s) =>
                `- **${s.name}** (${s.type}): ${s.status}` +
                (s.failure_streak ? `, failing or empty for ${s.failure_streak} consecutive runs` : "") +
                (s.error_message ? ` — ${s.error_message.replace(/\s+/g, " ").slice(0, 200)}` : ""),
            )
            .join("\n")}\n`
        : "";

    const purposeRows = Object.entries(m.articles_by_purpose)
      .map(([purpose, count]) => `| ${purpose} | ${count} |`)
      .join("\n");

    const statusIcons: Record<RunStatus, string> = { success: "✅", degraded: "⚠️", skipped: "⏭️", failed: "❌" };
    const runStatus = m.run_status ? `${statusIcons[m.run_status]} ${m.run_status}` : "N/A";
    const promptList = Object.entries(m.prompts ?? {})
      .map(([key, ref]) => `${key}: \`${ref}\``)
      .join(", ");
    const mapSuccess = m.map_attempted !== undefined ? `${m.map_succeeded ?? 0}/${m.map_attempted}` : "N/A";
    const reasonsSection =
      m.status_reasons && m.status_reasons.length > 0
        ? `\n### ⚠️ Run Status Reasons\n${m.status_reasons.map((r) => `- ${r}`).join("\n")}\n`
        : "";

    return `## 📊 Daily Pipeline Summary — ${m.date}

| Metric | Value |
|:---|:---|
| Run Status | ${runStatus} |
| Run ID | \`${m.run_id.slice(0, 8)}\` |
| Duration | ${m.duration_ms ? `${(m.duration_ms / 1000).toFixed(1)}s` : "N/A"} |
| Articles Ingested | ${m.articles_ingested} |
| Skipped (Evaluated Recently) | ${m.articles_skipped_evaluated} |
| Articles Scored | ${m.articles_scored} |
| Articles Selected | ${m.articles_selected} |
${triageRow}| Content Extraction (Failed / Description Fallback) | ${m.extraction.failed} / ${m.extraction.fallback} of ${m.extraction.attempted} |
| Map Success (Articles) | ${mapSuccess} |
| LLM Calls (Triage/Map/Reduce) | ${triageCalls.length}/${mapCalls}/${reduceCalls} |
| Total Tokens (In/Out) | ${m.total_tokens.input.toLocaleString()} / ${m.total_tokens.output.toLocaleString()} |
| Estimated Cost | $${m.total_cost_usd.toFixed(4)} |
| Quality Score | ${m.quality_score?.toFixed(1) ?? "N/A"} |
| Errors | ${m.errors.length} |
| Prompts | ${promptList || "N/A"} |
${reasonsSection}${sourceAlertsSection}
### Sources
| Source | Type | Status | Articles | Failure Streak |
|:---|:---|:---|:---|:---|
${sourceRows || "| (none) | — | — | — | — |"}

### Purpose Distribution
| Purpose | Count |
|:---|:---|
${purposeRows || "| (none) | — |"}
`;
  }

  /** Returns current metrics snapshot (non-finalized). */
  getSnapshot(): PipelineRunMetrics {
    return { ...this.metrics, prompts: { ...(this.metrics.prompts ?? {}) } };
  }
}

// Singleton instance
export const metrics = new MetricsCollector();
