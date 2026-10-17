/**
 * Tests for metrics.ts — LLM cost estimation and GitHub summary generation.
 */

import * as fs from "fs";
import * as path from "path";
import { estimateCost, metrics } from "../src/core/metrics";

describe("persist", () => {
  test("a run that did not succeed does not overwrite the metrics JSON of the day's successful run", () => {
    const dir = path.join(process.cwd(), "_tmp_ai", "test_metrics_persist");
    fs.rmSync(dir, { recursive: true, force: true });
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const date = metrics.getSnapshot().date;
      metrics.setRunStatus("success");
      expect(path.basename(metrics.persist(dir))).toBe(`${date}_metrics.json`);
      metrics.setRunStatus("failed", ["Fatal: disk full"]);
      expect(path.basename(metrics.persist(dir))).toBe(`${date}_metrics.failed.json`);
      expect(fs.readdirSync(dir).sort()).toEqual([`${date}_metrics.failed.json`, `${date}_metrics.json`]);
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("toGitHubSummary run status", () => {
  test("shows the run status, map success and the reasons of a degraded run", () => {
    metrics.setMapResults(10, 3);
    metrics.setRunStatus("degraded", ["Map success rate 30% (3/10 articles) is below the minimum of 50%"]);

    const summary = metrics.toGitHubSummary();

    expect(summary).toContain("| Run Status | ⚠️ degraded |");
    expect(summary).toContain("| Map Success (Articles) | 3/10 |");
    expect(summary).toContain(
      "### ⚠️ Run Status Reasons\n- Map success rate 30% (3/10 articles) is below the minimum of 50%",
    );
  });
});

describe("toGitHubSummary source alerts", () => {
  test("lists failing sources and long empty streaks, but not disabled or healthy ones", () => {
    metrics.recordSourceStatus({
      name: "Dead Feed",
      type: "rss",
      status: "error",
      article_count: 0,
      failure_streak: 1,
      error_message: "Status code 404",
    });
    metrics.recordSourceStatus({
      name: "Quiet Feed",
      type: "rss",
      status: "empty",
      article_count: 0,
      failure_streak: 3,
    });
    metrics.recordSourceStatus({
      name: "Paused Feed",
      type: "reddit",
      status: "disabled",
      article_count: 0,
      error_message: "enabled: false in config.yml",
    });
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
  test("uses the most specific pricing key", () => {
    // gpt-4.1-mini: $0.40/M input, $1.60/M output (not gpt-4.1's $2.00/$8.00)
    expect(estimateCost("gpt-4.1-mini", 1_000_000, 1_000_000)).toBeCloseTo(2.0, 5);
    expect(estimateCost("gpt-4.1-nano-2026-01", 1_000_000, 0)).toBeCloseTo(0.1, 5);
  });

  test("calculates Gemini Flash cost correctly", () => {
    // gemini-2.5-flash: $0.30/M input, $2.50/M output
    const cost = estimateCost("gemini-2.5-flash", 1000, 500);
    // Expected: (1000/1M)*0.30 + (500/1M)*2.50 = 0.0003 + 0.00125 = 0.00155
    expect(cost).toBeCloseTo(0.00155, 5);
    // gemini-2.5-flash-lite is priced by its own (longer) key: $0.10/M, $0.40/M
    expect(estimateCost("gemini-2.5-flash-lite", 1000, 500)).toBeCloseTo(0.0003, 5);
  });

  test("calculates Gemini Pro cost correctly", () => {
    // gemini-2.5-pro: $1.25/M input, $10.00/M output
    const cost = estimateCost("gemini-2.5-pro", 10000, 2000);
    // Expected: (10000/1M)*1.25 + (2000/1M)*10.00 = 0.0125 + 0.02 = 0.0325
    expect(cost).toBeCloseTo(0.0325, 4);
  });

  test("prices the models the auto-resolver picks today", () => {
    // gemini-3.5-flash-lite: $0.30/$2.50 (not gemini-3.1-flash-lite's $0.25/$1.50)
    expect(estimateCost("gemini-3.5-flash-lite", 1_000_000, 1_000_000)).toBeCloseTo(2.8, 5);
    // gemini-3.8-flash: $0.75/$3.75
    expect(estimateCost("gemini-3.8-flash", 1_000_000, 1_000_000)).toBeCloseTo(4.5, 5);
  });

  test("uses a given price table, e.g. settings.pricing from config.yml", () => {
    const table = { "my-model": { input: 1, output: 3 }, default: { input: 9, output: 9 } };
    expect(estimateCost("my-model-v2", 1_000_000, 1_000_000, table)).toBeCloseTo(4, 5);
    expect(estimateCost("other", 1_000_000, 0, table)).toBeCloseTo(9, 5);
    // A table without a default falls back to the built-in default.
    expect(estimateCost("other", 1_000_000, 0, {})).toBeCloseTo(0.5, 5);
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

describe("prompt tracking", () => {
  test("lists the recorded prompts in the step summary", () => {
    metrics.recordPrompt("map", "map_v1.md@0123abcd");
    expect(metrics.getSnapshot().prompts).toMatchObject({ map: "map_v1.md@0123abcd" });
    expect(metrics.toGitHubSummary()).toContain("| Prompts | map: `map_v1.md@0123abcd`");
  });
});
