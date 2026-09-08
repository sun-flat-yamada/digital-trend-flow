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
});
