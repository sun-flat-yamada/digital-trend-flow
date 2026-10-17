/**
 * Tests for insights.ts: keyword suggestions are mined from the state DB windows, and the report
 * is saved with both sections.
 */

import * as fs from "fs";
import * as path from "path";

const mockGetProcessedTitles = jest.fn();
jest.mock("../src/ingestion/state_manager", () => ({
  getProcessedTitles: (...args: unknown[]) => mockGetProcessedTitles(...args),
}));
jest.mock("../src/core/config", () => ({
  config: {
    purposes: { ai_research: { label: "AI", scoring: { keywords: [{ word: "LLM", weight: 10 }] } } },
    settings: {
      insights: {
        enabled: true,
        keyword_window_days: 30,
        background_days: 60,
        min_document_frequency: 3,
        trend_window_days: 30,
      },
    },
  },
}));

import { buildInsightsReport, saveInsightsReport, suggestKeywordsFromState } from "../src/aggregation/insights";

const outDir = path.join(process.cwd(), "_tmp_ai", "test_insights");

afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

beforeEach(() => {
  mockGetProcessedTitles.mockReset();
  mockGetProcessedTitles.mockImplementation((from: number) =>
    from === 30
      ? [
          { title: "Speculative decoding speeds up inference", purpose: "ai_research", date: "2026-10-01" },
          { title: "Speculative decoding in llama.cpp", purpose: "ai_research", date: "2026-10-04" },
          { title: "Speculative decoding explained", purpose: "ai_research", date: "2026-10-09" },
        ]
      : [{ title: "Unrelated background title", purpose: "business", date: "2026-08-20" }],
  );
});

test("compares the keyword window with the background window before it", () => {
  const suggestions = suggestKeywordsFromState();
  expect(mockGetProcessedTitles).toHaveBeenCalledWith(30, 0);
  expect(mockGetProcessedTitles).toHaveBeenCalledWith(90, 30);
  expect(suggestions[0]).toMatchObject({
    word: "Speculative decoding",
    frequency: 3,
    suggestedPurpose: "ai_research",
    suggestedWeight: 10,
  });
});

test("builds and saves the report with trend and keyword sections", () => {
  const report = buildInsightsReport("2026-10-17", "en");
  expect(report.markdown).toContain("## 📈 Topic Trends (last 30 days)");
  expect(report.markdown).toContain("| Speculative decoding | 3 |");

  const file = saveInsightsReport(report, "en", outDir);
  expect(file).toBe(path.join(outDir, "2026", "2026-10-17_digital-trend_insights.md"));
  expect(fs.readFileSync(file, "utf8")).toMatch(/^---\ntitle: "Insights 2026-10-17"\n[\s\S]*type: insights/);
});

test("still reports trends when the state DB cannot be read", () => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  mockGetProcessedTitles.mockImplementation(() => {
    throw new Error("no such table");
  });
  const report = buildInsightsReport("2026-10-17", "ja");
  expect(report.suggestions).toEqual([]);
  expect(report.markdown).toContain("候補はありません");
});
