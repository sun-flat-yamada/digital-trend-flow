/**
 * [Role] Langfuse observability integration.
 * [Mechanism] Wraps the Langfuse SDK to trace LLM calls, track prompt versions,
 * and record quality scores for debugging and cost analysis.
 *
 * Item: 4.3 Langfuse 統合
 */

import type { Langfuse, LangfuseTraceClient } from "langfuse";
import { env } from "../core/config";
import { errorMessage } from "./errors";

// Lazy-initialized Langfuse client
let langfuseClient: Langfuse | null = null;
let isAvailable = false;
// Trace of the current run: LLM generations recorded by the gateway are attached to it.
let activeTrace: LangfuseTraceClient | null = null;

/**
 * Initializes Langfuse if credentials are available.
 */
export function initLangfuse(): void {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    console.log("ℹ️ Langfuse tracing disabled (keys not set).");
    return;
  }

  try {
    // Loaded only when tracing is on: the gateway imports this module, and loading the SDK runs a
    // dynamic import that Jest (and any run without Langfuse keys) has no use for.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Langfuse: LangfuseClient } = require("langfuse") as typeof import("langfuse");
    langfuseClient = new LangfuseClient({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
    });
    isAvailable = true;
    console.log("🔭 Langfuse tracing enabled.");
  } catch (error) {
    console.warn(`⚠️ Langfuse initialization failed: ${errorMessage(error)}`);
  }
}

/**
 * Creates a new trace for a run and makes it the active trace, so that every LLM generation of
 * the run is recorded under it (see `recordGeneration`).
 * @param name Trace name; defaults to the daily pipeline's `pipeline-run-<date>`.
 */
export function createTrace(
  runId: string,
  date: string,
  name: string = `pipeline-run-${date}`,
): LangfuseTraceClient | null {
  if (!isAvailable || !langfuseClient) return null;
  try {
    activeTrace = langfuseClient.trace({
      id: runId,
      name,
      metadata: { date, pipeline: "digital-trend-flow" },
    });
    return activeTrace;
  } catch {
    return null;
  }
}

/** Returns the trace created by the last `createTrace` call, or null when tracing is off. */
export function getActiveTrace(): LangfuseTraceClient | null {
  return activeTrace;
}

/** Records a pipeline event (stage boundary) on a trace. */
export function recordEvent(
  trace: LangfuseTraceClient | null,
  name: string,
  metadata: Record<string, unknown> = {},
): void {
  if (!trace) return;
  try {
    trace.event({ name, metadata });
  } catch {
    // Non-fatal
  }
}

/**
 * Records an LLM generation span within a trace.
 */
export function recordGeneration(
  trace: LangfuseTraceClient | null,
  params: {
    name: string;
    model: string;
    input: string;
    output: string;
    promptVersion?: string | undefined;
    provider?: string | undefined;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costUsd: number;
  },
): void {
  if (!trace) return;
  try {
    const endTime = new Date();
    trace.generation({
      name: params.name,
      model: params.model,
      input: params.input.slice(0, 5000), // Truncate for storage
      output: params.output.slice(0, 5000),
      metadata: { promptVersion: params.promptVersion, provider: params.provider },
      usageDetails: {
        input: params.inputTokens,
        output: params.outputTokens,
        total: params.inputTokens + params.outputTokens,
      },
      costDetails: { total: params.costUsd },
      startTime: new Date(endTime.getTime() - params.latencyMs),
      endTime,
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Records a quality score for a trace.
 */
export function recordQualityScore(trace: LangfuseTraceClient | null, score: number): void {
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
  activeTrace = null;
}
