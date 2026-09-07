/**
 * Tests for keyword_expansion.ts — keyword discovery from article titles.
 */

import {
  discoverCandidateKeywords,
  formatSuggestionReport,
} from "../src/filtering/keyword_expansion";

jest.mock("../src/core/config", () => ({
  config: {
    purposes: {
      ai_research: {
        label: "🔬 AI・LLM 研究",
        scoring: {
          keywords: [
            { word: "transformer", weight: 12 },
            { word: "LLM", weight: 8 },
          ],
        },
      },
    },
    settings: {
      daily_threshold_score: 0,
      freshness: { enabled: false },
      llm_judge: { enabled: false },
      semantic_dedup: { enabled: false },
    },
  },
}));

describe("discoverCandidateKeywords", () => {
  test("discovers frequent unknown terms", () => {
    // "RLHF" appears 4 times but is NOT in any keyword list
    const titles = [
      "RLHF improves model alignment",
      "New RLHF techniques from OpenAI",
      "RLHF vs DPO comparison study",
      "Understanding RLHF for safety",
      "Vision models advance rapidly",
      "Vision models beat benchmarks",
      "Vision models in production",
    ];

    const suggestions = discoverCandidateKeywords(titles);
    const words = suggestions.map((s) => s.word);
    expect(words).toContain("RLHF");
  });

  test("does not suggest existing keywords", () => {
    const titles = [
      "transformer architecture review",
      "transformer model evaluation",
      "transformer papers from 2026",
      "LLM performance benchmark results",
      "LLM fine-tuning techniques reviewed",
    ];

    const suggestions = discoverCandidateKeywords(titles);
    const words = suggestions.map((s) => s.word.toLowerCase());
    // "transformer" and "LLM" are already in the keyword list
    expect(words).not.toContain("transformer");
    expect(words).not.toContain("llm");
  });

  test("filters out stopwords", () => {
    const titles = Array(10).fill("the quick brown fox jumps over lazy dog");
    const suggestions = discoverCandidateKeywords(titles);
    const words = suggestions.map((s) => s.word.toLowerCase());
    expect(words).not.toContain("the");
    expect(words).not.toContain("over");
  });

  test("returns empty array for insufficient data", () => {
    const suggestions = discoverCandidateKeywords(["Single article"]);
    expect(suggestions.length).toBe(0);
  });
});

describe("formatSuggestionReport", () => {
  test("formats non-empty suggestions as markdown table", () => {
    const suggestions = [
      { word: "RLHF", frequency: 5, suggestedPurpose: "ai_research", suggestedWeight: 2 },
    ];
    const report = formatSuggestionReport(suggestions);
    expect(report).toContain("RLHF");
    expect(report).toContain("ai_research");
    expect(report).toContain("|");
  });

  test("returns message for empty suggestions", () => {
    const report = formatSuggestionReport([]);
    expect(report).toContain("No new keyword suggestions");
  });
});
