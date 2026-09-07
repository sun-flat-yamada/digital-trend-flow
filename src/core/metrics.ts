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

// ── LLM Call Metrics ──

export interface LLMCallMetrics {
  phase: "map" | "reduce" | "judge" | "keyword_expansion" | "trend_detection";
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  estimated_cost_usd: number;
}

// ── Pipeline Run Metrics ──

export interface SourceStatus {
  name: string;
  type: string;
  status: "ok" | "empty" | "error";
  article_count: number;
  error_message?: string;
}

export interface PipelineRunMetrics {
  run_id: string;
  date: string;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  articles_ingested: number;
  articles_scored: number;
  articles_selected: number;
  articles_by_purpose: Record<string, number>;
  llm_calls: LLMCallMetrics[];
  total_tokens: { input: number; output: number };
  total_cost_usd: number;
  errors: string[];
  sources_status: SourceStatus[];
  quality_score?: number;
}

// ── Pricing Table (per 1M tokens, approximate as of 2026-04) ──

const PRICING: Record<string, { input: number; output: number }> = {
  // Google Gemini
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "gemini-2.5-pro": { input: 1.25, output: 5.00 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-pro": { input: 1.00, output: 4.00 },
  "gemini-3.0-flash": { input: 0.10, output: 0.40 },
  "gemini-3.0-pro": { input: 1.00, output: 4.00 },
  // OpenAI
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  // Anthropic
  "claude-sonnet-4": { input: 3.00, output: 15.00 },
  "claude-haiku-4": { input: 0.80, output: 4.00 },
  // Fallback
  "default": { input: 0.50, output: 2.00 },
};

/**
 * Estimates the cost of an LLM call based on known pricing.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Find best match in pricing table
  const pricing = Object.entries(PRICING).find(([key]) =>
    model.toLowerCase().includes(key.toLowerCase())
  )?.[1] ?? PRICING["default"]!;

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
      articles_scored: 0,
      articles_selected: 0,
      articles_by_purpose: {},
      llm_calls: [],
      total_tokens: { input: 0, output: 0 },
      total_cost_usd: 0,
      errors: [],
      sources_status: [],
    };
  }

  /** Records a single LLM API call with its metrics. */
  recordLLMCall(call: LLMCallMetrics): void {
    this.metrics.llm_calls.push(call);
    this.metrics.total_tokens.input += call.input_tokens;
    this.metrics.total_tokens.output += call.output_tokens;
    this.metrics.total_cost_usd += call.estimated_cost_usd;
  }

  /** Records the status of a source fetch. */
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

  /** Sets the per-purpose article distribution. */
  setArticlesByPurpose(distribution: Record<string, number>): void {
    this.metrics.articles_by_purpose = distribution;
  }

  /** Sets the quality score from the quality checker. */
  setQualityScore(score: number): void {
    this.metrics.quality_score = score;
  }

  /** Finalizes metrics and returns the complete record. */
  finalize(): PipelineRunMetrics {
    const now = new Date();
    this.metrics.finished_at = now.toISOString();
    this.metrics.duration_ms =
      now.getTime() - new Date(this.metrics.started_at).getTime();
    return this.metrics;
  }

  /** Persists metrics to a JSON file in ARTIFACTS_METRICS/. */
  persist(outputDir: string = PATHS.ARTIFACTS_METRICS.absolute): string {
    const absoluteDir = path.resolve(process.cwd(), outputDir);
    fs.mkdirSync(absoluteDir, { recursive: true });

    const filename = `${this.metrics.date}_metrics.json`;
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
    const judgeCalls = m.llm_calls.filter((c) => c.phase === "judge").length;

    const sourceRows = m.sources_status
      .map((s) => `| ${s.name} | ${s.type} | ${s.status} | ${s.article_count} |`)
      .join("\n");

    const purposeRows = Object.entries(m.articles_by_purpose)
      .map(([purpose, count]) => `| ${purpose} | ${count} |`)
      .join("\n");

    return `## 📊 Daily Pipeline Summary — ${m.date}

| Metric | Value |
|:---|:---|
| Run ID | \`${m.run_id.slice(0, 8)}\` |
| Duration | ${m.duration_ms ? `${(m.duration_ms / 1000).toFixed(1)}s` : "N/A"} |
| Articles Ingested | ${m.articles_ingested} |
| Articles Scored | ${m.articles_scored} |
| Articles Selected | ${m.articles_selected} |
| LLM Calls (Map/Reduce/Judge) | ${mapCalls}/${reduceCalls}/${judgeCalls} |
| Total Tokens (In/Out) | ${m.total_tokens.input.toLocaleString()} / ${m.total_tokens.output.toLocaleString()} |
| Estimated Cost | $${m.total_cost_usd.toFixed(4)} |
| Quality Score | ${m.quality_score?.toFixed(1) ?? "N/A"} |
| Errors | ${m.errors.length} |

### Sources
| Source | Type | Status | Articles |
|:---|:---|:---|:---|
${sourceRows || "| (none) | — | — | — |"}

### Purpose Distribution
| Purpose | Count |
|:---|:---|
${purposeRows || "| (none) | — |"}
`;
  }

  /** Returns current metrics snapshot (non-finalized). */
  getSnapshot(): PipelineRunMetrics {
    return { ...this.metrics };
  }
}

// Singleton instance
export const metrics = new MetricsCollector();
