/**
 * [Role] Publication gate for a pipeline run.
 * [Mechanism] Turns the Map/Reduce outcome and the quality score into a run status. A summary
 * that is not grounded in enough extracted facts, or that came from the Reduce fallback, is
 * "degraded": it must not be published, and its URLs must not be marked as processed.
 */

import type { RunStatus } from "../core/metrics";

export interface RunGateInput {
  mapAttempted: number; // selected articles sent to the Map phase
  mapSucceeded: number; // articles whose facts were extracted
  reduceUsedFallback?: boolean;
  qualityScore?: number; // 0-100, from evaluateQuality()
}

export interface RunGateThresholds {
  minMapSuccessRate: number; // 0-1
  minQualityScore: number; // 0-100
}

export interface RunGateResult {
  status: Extract<RunStatus, "success" | "degraded">;
  mapSuccessRate: number;
  reasons: string[]; // empty when status is "success"
}

const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

/**
 * Decides whether a run may be published. Every failed check adds a reason;
 * any reason makes the run "degraded".
 */
export function evaluateRunGate(input: RunGateInput, thresholds: RunGateThresholds): RunGateResult {
  const reasons: string[] = [];
  const mapSuccessRate = input.mapAttempted > 0 ? input.mapSucceeded / input.mapAttempted : 0;

  if (input.mapSucceeded === 0) {
    reasons.push(`No facts were extracted in the Map phase (0/${input.mapAttempted} articles)`);
  } else if (mapSuccessRate < thresholds.minMapSuccessRate) {
    reasons.push(
      `Map success rate ${percent(mapSuccessRate)} (${input.mapSucceeded}/${input.mapAttempted} articles) ` +
        `is below the minimum of ${percent(thresholds.minMapSuccessRate)}`
    );
  }

  if (input.reduceUsedFallback) {
    reasons.push("Reduce summarization failed and only the raw-facts fallback was produced");
  }

  if (input.qualityScore !== undefined && input.qualityScore < thresholds.minQualityScore) {
    reasons.push(
      `Quality score ${input.qualityScore.toFixed(1)} is below the minimum of ${thresholds.minQualityScore}`
    );
  }

  return { status: reasons.length > 0 ? "degraded" : "success", mapSuccessRate, reasons };
}
