import * as fs from "fs";
import * as path from "path";
import {
  markdownToHtml,
  parseDailySummary,
  scanDailySummaries,
  scanAllSummaries,
  generatePagesSite,
} from "../src/publishing/pages_generator";
import { PATHS } from "../src/core/paths";

describe("pages_generator", () => {
  const testDir = path.join(PATHS.TMP_AI, "test_pages");
  const testArtifactsDir = path.join(testDir, "artifacts");
  const testOutputDir = path.join(testDir, "_site");

  beforeAll(() => {
    fs.mkdirSync(testArtifactsDir, { recursive: true });
    fs.mkdirSync(testOutputDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("markdownToHtml", () => {
    it("should convert basic markdown elements into HTML", () => {
      const md = `
# Title
## Section 1
### Headline Item
- Bullet 1
- Bullet 2

> This is a quote

**出典**: https://example.com/source
`;
      const html = markdownToHtml(md);
      expect(html).toContain('<h1 class="summary-h1">Title</h1>');
      expect(html).toContain('<h2 class="summary-h2">Section 1</h2>');
      expect(html).toContain('<h3 class="summary-h3">Headline Item</h3>');
      expect(html).toContain('<ul class="summary-list">');
      expect(html).toContain("<li>Bullet 1</li>");
      expect(html).toContain('<blockquote class="summary-quote">');
      expect(html).toContain('<div class="article-source">');
      expect(html).toContain('href="https://example.com/source"');
    });

    it("should format inline markdown links and styles", () => {
      const md = "Here is [an article](https://example.com) with **bold** text and `code`.";
      const html = markdownToHtml(md);
      expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="link">an article</a>');
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<code>code</code>");
    });

    it("should correctly render foldable details and summary blocks for execution metrics", () => {
      const md = `
<details class="pipeline-metrics">
<summary>📊 記事生成メトリクス（所要時間・消費Token・コスト）</summary>

- **所要時間**: 42.5秒
- **消費Token**: 入力 12,500 / 出力 1,500 (合計: 14,000)
- **コスト**: $0.0035 (約 ¥0.54)
</details>
`;
      const html = markdownToHtml(md);
      expect(html).toContain('<details class="pipeline-metrics">');
      expect(html).toContain("<summary>📊 記事生成メトリクス（所要時間・消費Token・コスト）</summary>");
      expect(html).toContain('<ul class="summary-list">');
      expect(html).toContain("<li><strong>所要時間</strong>: 42.5秒</li>");
      expect(html).toContain("<li><strong>消費Token</strong>: 入力 12,500 / 出力 1,500 (合計: 14,000)</li>");
      expect(html).toContain("<li><strong>コスト</strong>: $0.0035 (約 ¥0.54)</li>");
      expect(html).toContain("</ul>");
      expect(html).toContain("</details>");
    });
  });

  describe("parseDailySummary", () => {
    it("should correctly parse frontmatter and content", () => {
      const filePath = path.join(testArtifactsDir, "2026-09-01_summary.md");
      const content = `---
title: Daily Summary 2026-09-01
date: 2026-09-01T04:00:00.000Z
type: daily_summary
top_story: OpenAI introduces next-gen model
categories:
  - 💼 ビジネス動向
  - 🤖 AI研究
tags:
  - OpenAI
  - GPT-5
articles_processed: 12
quality_score: 95
---

# Daily Summary 2026-09-01

## 💼 ビジネス動向

### OpenAI introduces next-gen model
**出典**: https://example.com/gpt5
- Massive performance boost
`;
      fs.writeFileSync(filePath, content, "utf8");

      const item = parseDailySummary(filePath);
      expect(item).not.toBeNull();
      expect(item?.date).toBe("2026-09-01");
      expect(item?.title).toBe("Daily Summary 2026-09-01");
      expect(item?.topStory).toBe("OpenAI introduces next-gen model");
      expect(item?.categories).toContain("💼 ビジネス動向");
      expect(item?.categories).toContain("🤖 AI研究");
      expect(item?.tags).toContain("OpenAI");
      expect(item?.articleCount).toBe(12);
      expect(item?.qualityScore).toBe(95);
      expect(item?.sourceUrl).toBe("https://example.com/gpt5");
      expect(item?.contentHtml).toContain("OpenAI introduces next-gen model");
    });

    it("should correctly parse English format with **Source**:", () => {
      const filePath = path.join(testArtifactsDir, "2026-09-03_summary.md");
      const content = `---
title: Daily Summary 2026-09-03
date: 2026-09-03T04:00:00.000Z
type: daily_summary
top_story: Anthropic releases Claude 4
categories:
  - 🔬 AI Research
tags:
  - Anthropic
  - Claude
articles_processed: 8
quality_score: 98
language: en
---

# Daily Summary 2026-09-03

## 🔬 AI Research

### Anthropic releases Claude 4
**Source**: [Anthropic Blog](https://anthropic.com/claude4)
- New frontier performance
`;
      fs.writeFileSync(filePath, content, "utf8");

      const item = parseDailySummary(filePath);
      expect(item).not.toBeNull();
      expect(item?.date).toBe("2026-09-03");
      expect(item?.title).toBe("Daily Summary 2026-09-03");
      expect(item?.topStory).toBe("Anthropic releases Claude 4");
      expect(item?.language).toBe("en");
      expect(item?.sourceUrl).toBe("https://anthropic.com/claude4");
      expect(item?.contentHtml).toContain('<div class="article-source">');
    });

    it("should correctly parse weekly report with reportType and period", () => {
      const filePath = path.join(testArtifactsDir, "2026-09-20_digital-trend_weekly_report.md");
      const content = `---
title: Weekly Trend Report 2026-W38
date: 2026-09-20
type: weekly_report
period: 2026-W38
top_story: AI agents transform dev workflows this week
categories:
  - 🛠️ 開発ツール・IDE統合
tags:
  - Agent
  - Coding
articles_processed: 45
---
# Weekly Trend Report 2026-W38
## 📈 今週のトレンド概要
A massive acceleration in AI agent adoption.
`;
      fs.writeFileSync(filePath, content, "utf8");

      const item = parseDailySummary(filePath);
      expect(item).not.toBeNull();
      expect(item?.reportType).toBe("weekly");
      expect(item?.period).toBe("2026-W38");
      expect(item?.id).toBe("weekly-2026-W38");
      expect(item?.articleCount).toBe(45);
      expect(item?.topStory).toBe("AI agents transform dev workflows this week");
    });

    it("should correctly parse monthly digest with reportType and period", () => {
      const filePath = path.join(testArtifactsDir, "2026-09-30_digital-trend_monthly_report.md");
      const content = `---
title: Monthly Digest 2026-09
date: 2026-09-30
type: monthly_report
period: 2026-09
top_story: "September highlights: Next-gen frontier architectures"
categories:
  - 🔬 AI研究
tags:
  - LLM
articles_processed: 180
---
# Monthly Digest 2026-09
## 📈 今月のトレンド概要
Overview of breakthroughs across September.
`;
      fs.writeFileSync(filePath, content, "utf8");

      const item = parseDailySummary(filePath);
      expect(item).not.toBeNull();
      expect(item?.reportType).toBe("monthly");
      expect(item?.period).toBe("2026-09");
      expect(item?.id).toBe("monthly-2026-09");
      expect(item?.articleCount).toBe(180);
    });

    it("should return null for non-existent file", () => {
      const item = parseDailySummary(path.join(testArtifactsDir, "non_existent.md"));
      expect(item).toBeNull();
    });
  });

  describe("scanAllSummaries", () => {
    it("should separate daily summaries and periodic reports into distinct collections", () => {
      const result = scanAllSummaries(testArtifactsDir);
      expect(result.all.length).toBeGreaterThanOrEqual(3);
      expect(result.daily.length).toBeGreaterThanOrEqual(1);
      expect(result.reports.length).toBeGreaterThanOrEqual(2);

      const hasWeekly = result.reports.some(r => r.reportType === "weekly");
      const hasMonthly = result.reports.some(r => r.reportType === "monthly");
      expect(hasWeekly).toBe(true);
      expect(hasMonthly).toBe(true);
    });
  });

  describe("generatePagesSite", () => {
    it("should generate all required static site files with relative paths in English by default", () => {
      // Create two sample summaries
      const file1 = path.join(testArtifactsDir, "2026-09-01_summary.md");
      const file2 = path.join(testArtifactsDir, "2026-09-02_summary.md");

      fs.writeFileSync(file1, `---
title: Daily Summary 2026-09-01
top_story: First Story
date: 2026-09-01
articles_processed: 5
categories:
  - Tech
---
# Summary 1
### First Story
`, "utf8");

      fs.writeFileSync(file2, `---
title: Daily Summary 2026-09-02
top_story: Second Story (Today's Headline)
date: 2026-09-02
articles_processed: 8
categories:
  - Business
---
# Summary 2
### Second Story (Today's Headline)
`, "utf8");

      const result = generatePagesSite(testArtifactsDir, testOutputDir);

      expect(result.summaryCount).toBeGreaterThanOrEqual(2);
      expect(result.latestDate).toBe("2026-09-03");

      // Verify files created
      const indexHtml = fs.readFileSync(path.join(testOutputDir, "index.html"), "utf8");
      const stylesCss = fs.readFileSync(path.join(testOutputDir, "styles.css"), "utf8");
      const appJs = fs.readFileSync(path.join(testOutputDir, "app.js"), "utf8");
      const jsonStr = fs.readFileSync(path.join(testOutputDir, "data", "summaries.json"), "utf8");
      const notFoundHtml = fs.readFileSync(path.join(testOutputDir, "404.html"), "utf8");

      // Verify relative paths for fork and subpath safety
      expect(indexHtml).toContain('href="./styles.css"');
      expect(indexHtml).toContain('src="./app.js"');
      expect(appJs).toContain("./data/summaries.json");

      // Verify English default UI elements
      expect(indexHtml).toContain('<html lang="en">');
      expect(indexHtml).toContain("Calendar");
      expect(indexHtml).toContain("Archive List");
      expect(indexHtml).toContain("Reports");
      expect(indexHtml).toContain('id="tabReportsBtn"');
      expect(indexHtml).toContain('id="reportsTab"');
      expect(indexHtml).toContain('data-filter="weekly"');
      expect(indexHtml).toContain('data-filter="monthly"');
      expect(indexHtml).toContain("TODAY&#039;S HEADLINE");
      expect(indexHtml).toContain("Has Summary");
      expect(indexHtml).toContain("Today");
      expect(indexHtml).toContain("Selected");

      // Verify JSON content
      const data = JSON.parse(jsonStr);
      expect(Array.isArray(data)).toBe(true);

      const reportsJsonStr = fs.readFileSync(path.join(testOutputDir, "data", "reports.json"), "utf8");
      const reportsData = JSON.parse(reportsJsonStr);
      expect(Array.isArray(reportsData)).toBe(true);
      expect(reportsData.some((r: any) => r.reportType === "weekly")).toBe(true);

      // Verify CSS and JS exist
      expect(stylesCss.length).toBeGreaterThan(100);
      expect(stylesCss).toContain(".cal-cell.is-today");
      expect(stylesCss).toContain(".cal-cell.selected");
      expect(stylesCss).toContain(".report-card");
      expect(stylesCss).toContain(".badge-headline.badge-weekly");
      expect(stylesCss).toContain("details.pipeline-metrics");
      expect(appJs.length).toBeGreaterThan(100);
      expect(appJs).toContain("renderPeriodicReportsList");
      expect(notFoundHtml).toContain("404");
    });

    it("should generate static site in Japanese when specified", () => {
      const jaOutputDir = path.join(testDir, "_site_ja");
      const result = generatePagesSite(testArtifactsDir, jaOutputDir, "ja");

      expect(result.summaryCount).toBeGreaterThanOrEqual(2);

      const indexHtml = fs.readFileSync(path.join(jaOutputDir, "index.html"), "utf8");
      expect(indexHtml).toContain('<html lang="ja">');
      expect(indexHtml).toContain("カレンダー");
      expect(indexHtml).toContain("リスト一覧");
      expect(indexHtml).toContain("定期レポート");
      expect(indexHtml).toContain("週次");
      expect(indexHtml).toContain("月次");
      expect(indexHtml).toContain("サマリーあり");
      expect(indexHtml).toContain("本日");
      expect(indexHtml).toContain("選択中");
    });

    it("should handle empty directories gracefully", () => {
      const emptyDir = path.join(testDir, "empty_artifacts");
      const emptyOut = path.join(testDir, "empty_site");
      fs.mkdirSync(emptyDir, { recursive: true });

      const result = generatePagesSite(emptyDir, emptyOut);
      expect(result.summaryCount).toBe(0);
      expect(result.latestDate).toBeNull();
      expect(fs.existsSync(path.join(emptyOut, "index.html"))).toBe(true);
    });
  });
});
