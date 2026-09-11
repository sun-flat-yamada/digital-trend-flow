/**
 * Tests for markdown_builder.ts — frontmatter generation and file output.
 */

import * as fs from "fs";
import * as path from "path";
import { saveMarkdownFile, SummaryFrontmatter } from "../src/storage/markdown_builder";
import { PATHS } from "../src/core/paths";

describe("saveMarkdownFile", () => {
  const testDir = path.join(PATHS.TMP_AI, "test_markdown");

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("creates markdown file with YAML frontmatter", () => {
    const filePath = saveMarkdownFile(
      testDir,
      "test_summary.md",
      "Test Summary",
      "## Content\n\nHello world.",
      5,
      "Test Author"
    );

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");

    // Check frontmatter delimiters
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("title: Test Summary");
    expect(content).toContain("articles_processed: 5");
    expect(content).toContain("author: Test Author");
    expect(content).toContain("## Content");
  });

  test("includes DataView-optimized frontmatter when provided", () => {
    const metadata: SummaryFrontmatter = {
      tags: ["AI", "LLM"],
      categories: ["research"],
      topPurpose: "ai_research",
      mentionedCompanies: ["OpenAI", "Google"],
      mentionedTechnologies: ["transformer"],
      estimatedCostUsd: 0.0042,
      qualityScore: 92.5,
      previousDate: "2026-04-17",
    };

    const filePath = saveMarkdownFile(
      testDir,
      "test_enriched.md",
      "Enriched Summary",
      "Content here.",
      10,
      "Author",
      metadata
    );

    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("top_purpose: ai_research");
    expect(content).toContain("quality_score: 92.5");
    expect(content).toContain("OpenAI");
    expect(content).toContain("transformer");
    // Check Obsidian backlink
    expect(content).toContain("[[2026-04-17_summary|前日のサマリー]]");
  });

  test("includes language in frontmatter and English backlink when language is en", () => {
    const metadata: SummaryFrontmatter = {
      language: "en",
      previousDate: "2026-09-07",
    };

    const filePath = saveMarkdownFile(
      testDir,
      "test_english.md",
      "English Summary",
      "English Content.",
      5,
      "Author",
      metadata
    );

    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("language: en");
    expect(content).toContain("[[2026-09-07_summary|Previous Summary]]");
  });

  test("creates parent directories automatically", () => {
    const nestedDir = path.join(testDir, "nested", "deep");
    const filePath = saveMarkdownFile(
      nestedDir,
      "nested_test.md",
      "Nested",
      "Body",
      1,
      "Author"
    );
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test("generates foldable execution metrics block at end of article with duration, tokens, and USD/JPY cost", () => {
    const metadata: SummaryFrontmatter = {
      executionTimeSec: 42.5,
      totalTokens: { input: 12500, output: 1500 },
      estimatedCostUsd: 0.0035,
      language: "ja",
      previousDate: "2026-09-10",
    };

    const filePath = saveMarkdownFile(
      testDir,
      "test_metrics.md",
      "Metrics Summary",
      "## 本日のニュース\n\nニュース内容です。",
      5,
      "Author",
      metadata
    );

    const content = fs.readFileSync(filePath, "utf8");
    // Check frontmatter
    expect(content).toContain("execution_time_sec: 42.5");
    expect(content).toContain("estimated_cost_usd: 0.0035");
    expect(content).toContain("total_tokens:\n  input: 12500\n  output: 1500");

    // Check foldable metrics block
    expect(content).toContain('<details class="pipeline-metrics">');
    expect(content).toContain('<summary>📊 記事生成メトリクス（所要時間・消費Token・コスト）</summary>');
    expect(content).toContain("- **所要時間**: 42.5秒");
    expect(content).toContain("- **消費Token**: 入力 12,500 / 出力 1,500 (合計: 14,000)");
    expect(content).toContain("- **コスト**: $0.0035 (約 ¥0.54)");
    expect(content).toContain("</details>");

    // Verify ordering: content -> metrics -> navigation link
    const contentIdx = content.indexOf("ニュース内容です。");
    const metricsIdx = content.indexOf('<details class="pipeline-metrics">');
    const footerIdx = content.indexOf("[[2026-09-10_summary|前日のサマリー]]");
    expect(contentIdx).toBeLessThan(metricsIdx);
    expect(metricsIdx).toBeLessThan(footerIdx);
  });

  test("generates English foldable execution metrics block when language is en", () => {
    const metadata: SummaryFrontmatter = {
      executionTimeSec: 15.2,
      totalTokens: { input: 5000, output: 800 },
      estimatedCostUsd: 0.0012,
      language: "en",
    };

    const filePath = saveMarkdownFile(
      testDir,
      "test_metrics_en.md",
      "Metrics Summary EN",
      "## Today News\n\nEnglish content.",
      3,
      "Author",
      metadata
    );

    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain('<details class="pipeline-metrics">');
    expect(content).toContain("<summary>📊 Execution Metrics (Time, Tokens, Cost)</summary>");
    expect(content).toContain("- **Execution Time**: 15.2s");
    expect(content).toContain("- **Tokens Used**: Input 5,000 / Output 800 (Total: 5,800)");
    expect(content).toContain("- **Estimated Cost**: $0.0012 (approx. ¥0.19)");
  });
});
