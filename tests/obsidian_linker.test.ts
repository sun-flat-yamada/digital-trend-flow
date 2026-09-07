/**
 * Tests for obsidian_linker.ts — entity extraction and frontmatter enrichment.
 */

import {
  extractMentionedCompanies,
  extractMentionedTechnologies,
  buildEnrichedFrontmatter,
} from "../src/storage/obsidian_linker";

jest.mock("../src/core/config", () => ({
  config: { settings: { author: "test" } },
}));

describe("extractMentionedCompanies", () => {
  test("detects known companies", () => {
    const text = "OpenAI released GPT-5, while Google DeepMind published new research.";
    const companies = extractMentionedCompanies(text);
    expect(companies).toContain("OpenAI");
    expect(companies).toContain("Google");
  });

  test("is case-insensitive", () => {
    const text = "nvidia announced new GPU architecture alongside microsoft's AI updates.";
    const companies = extractMentionedCompanies(text);
    expect(companies).toContain("NVIDIA");
    expect(companies).toContain("Microsoft");
  });

  test("returns empty for unrelated text", () => {
    const text = "The weather is sunny today with clear skies.";
    const companies = extractMentionedCompanies(text);
    expect(companies.length).toBe(0);
  });
});

describe("extractMentionedTechnologies", () => {
  test("detects known technologies", () => {
    const text = "The new LLM uses transformer architecture with RAG and fine-tuning.";
    const techs = extractMentionedTechnologies(text);
    expect(techs).toContain("LLM");
    expect(techs).toContain("transformer");
    expect(techs).toContain("RAG");
    expect(techs).toContain("fine-tuning");
  });

  test("handles empty text", () => {
    const techs = extractMentionedTechnologies("");
    expect(techs.length).toBe(0);
  });
});

describe("buildEnrichedFrontmatter", () => {
  test("builds complete frontmatter object", () => {
    const fm = buildEnrichedFrontmatter({
      tags: ["AI", "LLM"],
      categories: ["research"],
      sources: ["arxiv"],
      articleCount: 5,
      topPurpose: "ai_research",
      summaryText: "OpenAI released a new transformer model with LLM capabilities.",
      costUsd: 0.0123,
      executionTimeSec: 45.6,
      qualityScore: 85.5,
      topStory: "Test Story",
      previousDate: "2026-04-17",
    });

    expect(fm.tags).toEqual(["AI", "LLM"]);
    expect(fm.article_count).toBe(5);
    expect(fm.top_purpose).toBe("ai_research");
    expect(fm.mentioned_companies).toContain("OpenAI");
    expect(fm.mentioned_technologies).toContain("transformer");
    expect(fm.mentioned_technologies).toContain("LLM");
    expect(fm.estimated_cost_usd).toBe(0.0123);
    expect(fm.quality_score).toBe(85.5);
    expect(fm.previous).toBe("2026-04-17_summary");
  });

  test("limits tags to 20", () => {
    const manyTags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    const fm = buildEnrichedFrontmatter({
      tags: manyTags,
      categories: [],
      sources: [],
      articleCount: 0,
      topPurpose: "",
      summaryText: "",
      costUsd: 0,
      executionTimeSec: 0,
      qualityScore: 0,
      topStory: "",
      previousDate: "",
    });
    expect(fm.tags.length).toBe(20);
  });
});
