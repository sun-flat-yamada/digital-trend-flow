/**
 * Unit tests for the publication gate that decides whether a run may be published.
 */

import { evaluateRunGate } from "../src/evaluation/run_gate";

const thresholds = { minMapSuccessRate: 0.5, minQualityScore: 60 };

describe("evaluateRunGate", () => {
  test("passes a run with enough extracted facts and a good summary", () => {
    const result = evaluateRunGate(
      { mapAttempted: 10, mapSucceeded: 9, reduceUsedFallback: false, qualityScore: 95 },
      thresholds
    );

    expect(result.status).toBe("success");
    expect(result.reasons).toEqual([]);
    expect(result.mapSuccessRate).toBeCloseTo(0.9);
  });

  test("degrades a run where no facts were extracted (the 2026-09-23..30 incident)", () => {
    const result = evaluateRunGate({ mapAttempted: 10, mapSucceeded: 0 }, thresholds);

    expect(result.status).toBe("degraded");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("No facts were extracted");
  });

  test("degrades a run whose map success rate is below the minimum", () => {
    const result = evaluateRunGate({ mapAttempted: 9, mapSucceeded: 3, qualityScore: 100 }, thresholds);

    expect(result.status).toBe("degraded");
    expect(result.reasons[0]).toContain("Map success rate 33% (3/9 articles)");
  });

  test("passes a run exactly at the minimum map success rate", () => {
    const result = evaluateRunGate({ mapAttempted: 10, mapSucceeded: 5, qualityScore: 100 }, thresholds);

    expect(result.status).toBe("success");
  });

  test("degrades a run whose Reduce phase fell back to raw facts", () => {
    const result = evaluateRunGate(
      { mapAttempted: 4, mapSucceeded: 4, reduceUsedFallback: true, qualityScore: 76 },
      thresholds
    );

    expect(result.status).toBe("degraded");
    expect(result.reasons).toEqual(["Reduce summarization failed and only the raw-facts fallback was produced"]);
  });

  test("degrades a run whose quality score is below the minimum and lists every reason", () => {
    const result = evaluateRunGate(
      { mapAttempted: 10, mapSucceeded: 2, reduceUsedFallback: true, qualityScore: 41.5 },
      thresholds
    );

    expect(result.status).toBe("degraded");
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons[2]).toBe("Quality score 41.5 is below the minimum of 60");
  });
});
