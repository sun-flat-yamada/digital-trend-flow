/**
 * Tests for keyword_expansion.ts — keyword discovery from article titles.
 */

import {
  discoverCandidateKeywords,
  discoverKeywordsFromHistory,
  extractTerms,
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
      triage: { enabled: false },
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
    const suggestions = [{ word: "RLHF", frequency: 5, suggestedPurpose: "ai_research", suggestedWeight: 2 }];
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

describe("discoverKeywordsFromHistory", () => {
  const doc = (title: string, date: string, purpose = "ai_research") => ({ title, date, purpose });

  test("suggests terms over-represented in the recent window, with the purpose they were selected for", () => {
    const recent = [
      doc("Sparse attention cuts memory in half", "2026-10-01"),
      doc("Why sparse attention matters for long context", "2026-10-03"),
      doc("Sparse attention kernels land in vLLM", "2026-10-05"),
      doc("Day one of the conference", "2026-10-05", "business"),
      doc("Another day, another model", "2026-10-06", "business"),
      doc("A day of updates", "2026-10-07", "business"),
    ];
    const background = [
      doc("Benchmarks for long context models", "2026-09-01"),
      doc("Long context retrieval study", "2026-09-02"),
      doc("Long context is not enough", "2026-09-03"),
    ];

    const suggestions = discoverKeywordsFromHistory(recent, background);
    const words = suggestions.map((s) => s.word.toLowerCase());

    expect(words[0]).toBe("sparse attention"); // the phrase replaces its words
    expect(words).not.toContain("sparse");
    expect(words).not.toContain("day"); // generic word
    expect(words).not.toContain("long context"); // as frequent before: no lift
    expect(suggestions[0]).toMatchObject({ frequency: 3, suggestedPurpose: "ai_research", suggestedWeight: 12 });
    expect(suggestions[0]!.lift).toBeGreaterThan(2);
  });

  test("ignores a burst on a single day", () => {
    const recent = [
      doc("Stabbing reported downtown", "2026-10-01", "geopolitics"),
      doc("Stabbing suspect arrested", "2026-10-01", "geopolitics"),
      doc("Stabbing victims named", "2026-10-01", "geopolitics"),
    ];
    expect(discoverKeywordsFromHistory(recent, [])).toEqual([]);
  });
});

describe("extractTerms", () => {
  test("drops numbers and stopwords, keeps words and two-word phrases", () => {
    expect(extractTerms("OpenAI raises $40 billion in 2026")).toEqual(
      expect.arrayContaining(["OpenAI", "OpenAI raises", "raises", "billion"]),
    );
    expect(extractTerms("OpenAI raises $40 billion in 2026")).not.toContain("2026");
    expect(extractTerms("What the day says")).toEqual([]);
  });
});
