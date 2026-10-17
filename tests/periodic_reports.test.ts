/**
 * Tests for the weekly and yearly reports and the report CLI: inputs are read from the daily
 * summaries and monthly digests, an LLM failure fails the run, and the default period is the
 * previous complete one.
 */

import * as fs from "fs";
import * as path from "path";

const mockRoot = path.resolve(__dirname, "..", "_tmp_ai", "test_periodic_reports");

jest.mock("../src/core/paths", () => {
  const p = require("path");
  const abs = (sub: string) => ({ absolute: p.join(mockRoot, sub), relative: sub });
  return {
    PATHS: {
      ARTIFACTS_DAILY: abs("daily"),
      ARTIFACTS_WEEKLY: abs("weekly"),
      ARTIFACTS_MONTHLY: abs("monthly"),
      ARTIFACTS_YEARLY: abs("yearly"),
      ARTIFACTS_ZENN: abs("zenn"),
      ARTIFACTS_NOTE: abs("note"),
      DB: p.join(mockRoot, "state.db"),
      PROMPTS: p.join(mockRoot, "prompts"),
      TMP_AI: mockRoot,
    },
  };
});
jest.mock("../src/core/config", () => ({ config: { settings: { author: "test" } }, env: {} }));
jest.mock("../src/summarization/llm_gateway", () => ({ llmCall: jest.fn() }));

import { generateWeeklyDigest, resolveWeek } from "../src/aggregation/weekly_digest";
import { generateYearlyReport, readMonthlyDigests } from "../src/aggregation/yearly_report";
import { defaultPeriod } from "../src/cli/report";
import { llmCall } from "../src/summarization/llm_gateway";

const mockLlm = llmCall as jest.Mock;

function write(rel: string, content: string): void {
  const file = path.join(mockRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

const daily = (date: string, topStory: string, tags: string[]) =>
  `---\ntitle: Daily Summary ${date}\narticles_processed: 4\ntop_story: ${topStory}\ncategories:\n  - 🔬 AI\ntags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n---\n\n## 🔥 Top\n### ${topStory}\n`;

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  // ISO week 2026-W42 is 2026-10-12 .. 2026-10-18
  write("daily/2026/10/2026-10-12_digital-trend_daily_summary.md", daily("2026-10-12", "Story A", ["Gemini"]));
  write("daily/2026/10/2026-10-14_digital-trend_daily_summary.md", daily("2026-10-14", "Story B", ["Gemini", "RAG"]));
  write("daily/2026/10/2026-10-19_digital-trend_daily_summary.md", daily("2026-10-19", "Next week", ["Other"]));
  write("daily/2026/10/notes.md", "not a summary");
  // Monthly digests: September filed in 2026, December filed in 2027 (generated in January)
  write(
    "monthly/2026/2026-10-01_digital-trend_monthly_report.md",
    "---\ntitle: Monthly Digest 2026-09\ntags:\n  - Gemini\n---\n\nSeptember body\n",
  );
  write(
    "monthly/2027/2027-01-01_digital-trend_monthly_report.md",
    "---\ntitle: Monthly Digest 2026-12\nperiod: 2026-12\n---\n\nDecember body\n",
  );
  write(
    "monthly/2027/2027-02-01_digital-trend_monthly_report.md",
    "---\ntitle: Monthly Digest 2027-01\n---\n\nJanuary body\n",
  );
});

afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
  jest.restoreAllMocks();
});

beforeEach(() => mockLlm.mockReset());

describe("weekly digest", () => {
  test("resolveWeek accepts an ISO week or a date", () => {
    expect(resolveWeek("2026-W42")).toEqual({ isoWeek: "2026-W42", startDate: "2026-10-12", endDate: "2026-10-18" });
    expect(resolveWeek("2026-10-18").isoWeek).toBe("2026-W42");
    expect(() => resolveWeek("last week")).toThrow("Invalid week");
  });

  test("aggregates the week's daily summaries and saves a weekly_report", async () => {
    mockLlm.mockResolvedValueOnce({ text: "## 📈 今週のトレンド概要\n\nweekly analysis" });

    const report = await generateWeeklyDigest("2026-W42");

    expect(report).toMatchObject({
      kind: "weekly",
      period: "2026-W42",
      endDate: "2026-10-18",
      articleCount: 8,
      tags: ["Gemini", "RAG"],
    });
    const prompt = mockLlm.mock.calls[0]![0].userPrompt as string;
    expect(prompt).toContain("Total daily summaries: 2");
    expect(prompt).not.toContain("Next week");
    expect(report!.markdown).toContain("weekly analysis");
    expect(report!.markdown).toContain("トピックの推移"); // Gemini appears on 2 days of the window
    const saved = fs.readFileSync(report!.outputPath, "utf8");
    expect(saved).toContain("type: weekly_report");
    expect(saved).toContain("period: 2026-W42");
    expect(report!.outputPath).toContain(path.join("weekly", "2026", "2026-10-18_digital-trend_weekly_report.md"));
  });

  test("throws when the LLM call fails", async () => {
    mockLlm.mockRejectedValueOnce(new Error("All LLM providers failed"));
    await expect(generateWeeklyDigest("2026-W42")).rejects.toThrow("Weekly digest generation failed for 2026-W42");
  });

  test("resolves with null for a week without daily summaries", async () => {
    await expect(generateWeeklyDigest("2030-W01")).resolves.toBeNull();
  });
});

describe("yearly report", () => {
  test("readMonthlyDigests attributes each digest to its month, across the year folders", () => {
    expect(readMonthlyDigests("2026").map((m) => m.month)).toEqual(["2026-09", "2026-12"]);
  });

  test("aggregates monthly digests and daily top stories", async () => {
    mockLlm.mockResolvedValueOnce({ text: "## 📈 今年のトレンド総括\n\nyearly analysis" });

    const report = await generateYearlyReport("2026");

    expect(report).toMatchObject({ kind: "yearly", period: "2026", endDate: "2026-12-31", articleCount: 12 }); // 3 daily summaries × 4 articles
    const prompt = mockLlm.mock.calls[0]![0].userPrompt as string;
    expect(prompt).toContain("September body");
    expect(prompt).toContain("December body");
    expect(prompt).not.toContain("January body");
    expect(prompt).toContain("- 2026-10-14: Story B");
    expect(fs.readFileSync(report!.outputPath, "utf8")).toContain("type: yearly_report");
    expect(path.basename(report!.outputPath)).toBe("2026_digital-trend_yearly_report.md");
  });

  test("throws when the LLM call fails and resolves with null for an empty year", async () => {
    mockLlm.mockRejectedValueOnce(new Error("quota"));
    await expect(generateYearlyReport("2026")).rejects.toThrow("Yearly report generation failed for 2026: quota");
    await expect(generateYearlyReport("2019")).resolves.toBeNull();
    await expect(generateYearlyReport("26")).rejects.toThrow("Invalid year");
  });
});

describe("report CLI", () => {
  test("defaultPeriod is the previous complete period", () => {
    // The weekly workflow runs on Mondays, the monthly on the 1st, the yearly on January 2nd.
    expect(defaultPeriod("weekly", new Date("2026-10-19T02:17:00Z"))).toBe("2026-W42");
    expect(defaultPeriod("weekly", new Date("2027-01-04T02:17:00Z"))).toBe("2026-W53");
    expect(defaultPeriod("monthly", new Date("2026-11-01T19:30:00Z"))).toBe("2026-10");
    expect(defaultPeriod("monthly", new Date("2027-01-01T19:30:00Z"))).toBe("2026-12");
    expect(defaultPeriod("yearly", new Date("2027-01-02T20:43:00Z"))).toBe("2026");
  });
});
