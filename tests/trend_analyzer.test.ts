/**
 * Tests for trend_analyzer.ts: topics come from the daily summaries' frontmatter and are
 * classified by the older and recent half of the window.
 */

import * as fs from "fs";
import * as path from "path";
import { analyzeTopicTrends, extractSummaryTopics, formatTrendAnalysis } from "../src/aggregation/trend_analyzer";

const root = path.join(process.cwd(), "_tmp_ai", "test_trend_analyzer");

function writeDaily(date: string, frontmatter: string): void {
  const [y, m] = date.split("-") as [string, string];
  const dir = path.join(root, y, m);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${date}_digital-trend_daily_summary.md`),
    `---\n${frontmatter}\n---\n\nbody\n`,
    "utf8",
  );
}

beforeAll(() => {
  // Window: 2026-09-18 .. 2026-10-17 (30 days); halfway 2026-10-02
  writeDaily("2026-09-20", "tags:\n  - Gemini\n  - export controls\nmentioned_companies:\n  - Google");
  writeDaily("2026-09-25", "tags:\n  - Gemini\n  - export controls\nmentioned_companies:\n  - Google");
  writeDaily("2026-09-28", "tags:\n  - export controls");
  writeDaily("2026-10-05", "tags:\n  - Gemini\n  - agents\nmentioned_companies:\n  - google");
  writeDaily("2026-10-10", "tags:\n  - Gemini\n  - agents");
  writeDaily("2026-10-12", "tags:\n  - Gemini");
  writeDaily("2026-10-15", "tags:\n  - Gemini\n  - Agents\n  - one-off");
  writeDaily("2026-08-01", "tags:\n  - outside window");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

test("extractSummaryTopics merges tags, companies and technologies case-insensitively", () => {
  expect(extractSummaryTopics("---\ntags:\n  - RAG\nmentioned_technologies:\n  - rag\n  - LoRA\n---\nbody")).toEqual([
    "RAG",
    "LoRA",
  ]);
  expect(extractSummaryTopics("no frontmatter")).toEqual([]);
});

test("classifies rising, new, declining and stable topics", () => {
  const trends = analyzeTopicTrends(30, new Date("2026-10-17T00:00:00Z"), root);
  const byTopic = new Map(trends.map((t) => [t.topic.toLowerCase(), t]));

  expect(byTopic.get("agents")).toMatchObject({ trend: "new", totalMentions: 3 });
  expect(byTopic.get("gemini")).toMatchObject({ trend: "rising", olderMentions: 2, recentMentions: 4 });
  expect(byTopic.get("export controls")).toMatchObject({ trend: "declining", recentMentions: 0 });
  expect(byTopic.get("google")).toMatchObject({ trend: "stable", olderMentions: 2, recentMentions: 1 });
  expect(byTopic.has("one-off")).toBe(false);
  expect(byTopic.has("outside window")).toBe(false);
});

test("formats the analysis in Japanese and English", () => {
  const trends = analyzeTopicTrends(30, new Date("2026-10-17T00:00:00Z"), root);
  expect(formatTrendAnalysis(trends, "ja")).toContain("### 🆕 新規トピック");
  const en = formatTrendAnalysis(trends, "en");
  expect(en).toContain("### 📈 Rising");
  expect(en).toContain("**Agents**: mentioned on 3 days");
  expect(formatTrendAnalysis([], "en")).toBe("");
});
