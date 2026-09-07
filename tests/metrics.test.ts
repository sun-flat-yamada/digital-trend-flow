/**
 * Tests for metrics.ts — LLM cost estimation and GitHub summary generation.
 */

import { estimateCost } from "../src/core/metrics";

describe("estimateCost", () => {
  test("calculates Gemini Flash cost correctly", () => {
    // gemini-2.5-flash: $0.15/M input, $0.60/M output
    const cost = estimateCost("gemini-2.5-flash", 1000, 500);
    // Expected: (1000/1M)*0.15 + (500/1M)*0.60 = 0.00015 + 0.0003 = 0.00045
    expect(cost).toBeCloseTo(0.00045, 5);
  });

  test("calculates Gemini Pro cost correctly", () => {
    // gemini-2.5-pro: $1.25/M input, $5.00/M output
    const cost = estimateCost("gemini-2.5-pro", 10000, 2000);
    // Expected: (10000/1M)*1.25 + (2000/1M)*5.00 = 0.0125 + 0.01 = 0.0225
    expect(cost).toBeCloseTo(0.0225, 4);
  });

  test("calculates OpenAI GPT-4.1 cost correctly", () => {
    const cost = estimateCost("gpt-4.1", 5000, 1000);
    // Expected: (5000/1M)*2.00 + (1000/1M)*8.00 = 0.01 + 0.008 = 0.018
    expect(cost).toBeCloseTo(0.018, 4);
  });

  test("uses default pricing for unknown models", () => {
    const cost = estimateCost("some-unknown-model-xyz", 1000, 1000);
    // default: $0.50/M input, $2.00/M output
    // Expected: (1000/1M)*0.50 + (1000/1M)*2.00 = 0.0005 + 0.002 = 0.0025
    expect(cost).toBeCloseTo(0.0025, 4);
  });

  test("returns 0 for zero tokens", () => {
    const cost = estimateCost("gemini-2.5-flash", 0, 0);
    expect(cost).toBe(0);
  });

  test("handles partial model name matches", () => {
    // Model name contains "flash" -> should match a flash pricing
    const cost = estimateCost("gemini-3.0-flash-latest", 1000, 1000);
    expect(cost).toBeGreaterThan(0);
  });
});
