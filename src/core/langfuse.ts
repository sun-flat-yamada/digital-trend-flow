/**
 * [Role] Langfuse observability integration.
 * [Mechanism] Wraps the Langfuse SDK to trace LLM calls, track prompt versions,
 * and record quality scores for debugging and cost analysis.
 *
 * Item: 4.3 Langfuse 統合
 */

import { env } from "../core/config";

// Lazy-initialized Langfuse client
let langfuseClient: any = null;
let isAvailable = false;

/**
 * Initializes Langfuse if credentials are available.
 */
export function initLangfuse(): void {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    console.log("ℹ️ Langfuse tracing disabled (keys not set).");
    return;
  }

  try {
    // Dynamic import to avoid hard dependency
    const { Langfuse } = require("langfuse");
    langfuseClient = new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
    });
    isAvailable = true;
    console.log("🔭 Langfuse tracing enabled.");
  } catch (error: any) {
    console.warn(`⚠️ Langfuse initialization failed: ${error.message}`);
  }
}

/**
 * Creates a new trace for a pipeline run.
 */
export function createTrace(runId: string, date: string): any {
  if (!isAvailable || !langfuseClient) return null;
  try {
    return langfuseClient.trace({
      id: runId,
      name: `pipeline-run-${date}`,
      metadata: { date, pipeline: "digital-trend-flow" },
    });
  } catch {
    return null;
  }
}

/**
 * Records an LLM generation span within a trace.
 */
export function recordGeneration(
  trace: any,
  params: {
    name: string;
    model: string;
    input: string;
    output: string;
    promptVersion?: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costUsd: number;
  }
): void {
  if (!trace) return;
  try {
    trace.generation({
      name: params.name,
      model: params.model,
      input: params.input.slice(0, 5000), // Truncate for storage
      output: params.output.slice(0, 5000),
      metadata: { promptVersion: params.promptVersion },
      usage: {
        promptTokens: params.inputTokens,
        completionTokens: params.outputTokens,
        totalCost: params.costUsd,
      },
      startTime: new Date(Date.now() - params.latencyMs),
      endTime: new Date(),
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Records a quality score for a trace.
 */
export function recordQualityScore(trace: any, score: number): void {
  if (!trace) return;
  try {
    trace.score({
      name: "quality",
      value: score / 100, // Normalize to 0-1
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Flushes any pending Langfuse events.
 */
export async function flushLangfuse(): Promise<void> {
  if (!isAvailable || !langfuseClient) return;
  try {
    await langfuseClient.shutdownAsync();
  } catch {
    // Non-fatal
  }
}
