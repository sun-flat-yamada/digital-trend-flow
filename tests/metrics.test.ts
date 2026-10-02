/**
 * Tests for metrics.ts — LLM cost estimation and GitHub summary generation.
 */

import { estimateCost, metrics } from "../src/core/metrics";

describe("toGitHubSummary run status", () => {
  test("shows the run status, map success and the reasons of a degraded run", () => {
    metrics.setMapResults(10, 3);
    metrics.setRunStatus("degraded", ["Map success rate 30% (3/10 articles) is below the minimum of 50%"]);

    const summary = metrics.toGitHubSummary();

    expect(summary).toContain("| Run Status | ⚠️ degraded |");
    expect(summary).toContain("| Map Success (Articles) | 3/10 |");
    expect(summary).toContain("### ⚠️ Run Status Reasons\n- Map success rate 30% (3/10 articles) is below the minimum of 50%");
  });
});

describe("toGitHubSummary source alerts", () => {
  test("lists failing sources and long empty streaks, but not disabled or healthy ones", () => {
    metrics.recordSourceStatus({ name: "Dead Feed", type: "rss", status: "error", article_count: 0, failure_streak: 1, error_message: "Status code 404" });
    metrics.recordSourceStatus({ name: "Quiet Feed", type: "rss", status: "empty", article_count: 0, failure_streak: 3 });
    metrics.recordSourceStatus({ name: "Paused Feed", type: "reddit", status: "disabled", article_count: 0, error_message: "enabled: false in config.yml" });
    metrics.recordSourceStatus({ name: "Good Feed", type: "rss", status: "ok", article_count: 5, failure_streak: 0 });

    const summary = metrics.toGitHubSummary();
    const alerts = summary.slice(summary.indexOf("### 🚨 Source Alerts"), summary.indexOf("### Sources"));

    expect(alerts).toContain("- **Dead Feed** (rss): error, failing or empty for 1 consecutive runs — Status code 404");
    expect(alerts).toContain("- **Quiet Feed** (rss): empty, failing or empty for 3 consecutive runs");
    expect(alerts).not.toContain("Paused Feed");
    expect(alerts).not.toContain("Good Feed");
    expect(summary).toContain("| Paused Feed | reddit | disabled | 0 | — |");
  });
});

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
