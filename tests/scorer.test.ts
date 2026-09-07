/**
 * Item 7.3: Scoring unit tests for scorer.ts
 */

import {
  normalizeUrl,
  excludeByMetadata,
  classifyExclusion,
  cleanseMarkdownContext,
  titlePassesPreScreen,
  calculatePurposeScore,
  assignBestPurpose,
  calculateFreshnessFactor,
} from "../src/filtering/scorer";

// Mock config for tests
jest.mock("../src/core/config", () => ({
  config: {
    purposes: {
      ai_research: {
        label: "🔬 AI・LLM 研究",
        priority: 1,
        quota: { min: 2, max: 5 },
        scoring: {
          threshold: 8,
          title_multiplier: 2,
          keywords: [
            { word: "transformer", weight: 12 },
            { word: "LLM", weight: 8 },
            { word: "GPT", weight: 8 },
            { word: "AI", weight: 4 },
          ],
        },
        sources: [],
      },
      business: {
        label: "💼 ビジネス動向",
        priority: 3,
        quota: { min: 1, max: 4 },
        scoring: {
          threshold: 5,
          title_multiplier: 1.5,
          keywords: [
            { word: "acquisition", weight: 10 },
            { word: "funding", weight: 8 },
          ],
        },
        sources: [],
      },
      curated: {
        label: "📌 手動キュレーション",
        priority: 5,
        quota: { min: 0, max: 3 },
        scoring: null,
        sources: [],
      },
    },
    exclude: {
      domains: ["prtimes.jp", "prnewswire.com"],
      url_strip_parameters: ["utm_source", "utm_medium", "utm_campaign"],
      keywords: ["PR:", "Sponsored"],
      content_length: { min: 200, max: 50000 },
    },
    settings: {
      daily_threshold_score: 0,
      freshness: { enabled: true, decay_lambda: 0.02, max_age_hours: 72 },
      llm_judge: { enabled: false, weight: 0.5 },
      semantic_dedup: { enabled: false, similarity_threshold: 0.92 },
    },
  },
  env: { GEMINI_API_KEY: "test-key" },
}));

describe("normalizeUrl", () => {
  test("strips UTM parameters", () => {
    const raw = "https://example.com/article?utm_source=twitter&utm_medium=social&id=123";
    const result = normalizeUrl(raw);
    expect(result).toBe("https://example.com/article?id=123");
  });

  test("handles URLs without parameters", () => {
    const raw = "https://example.com/article";
    expect(normalizeUrl(raw)).toBe("https://example.com/article");
  });

  test("returns raw URL on invalid input", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("excludeByMetadata", () => {
  test("excludes blocked domains", () => {
    const result = excludeByMetadata("Some Article", "https://prtimes.jp/article/123");
    expect(result.excluded).toBe(true);
    expect(result.reason).toContain("Domain blocked");
  });

  test("excludes NG keywords in title", () => {
    const result = excludeByMetadata("PR: Product Launch", "https://example.com/article");
    expect(result.excluded).toBe(true);
    expect(result.reason).toContain("NG Keyword");
  });

  test("passes clean articles", () => {
    const result = excludeByMetadata("New AI Research Paper", "https://arxiv.org/abs/123");
    expect(result.excluded).toBe(false);
  });
});

describe("classifyExclusion", () => {
  test("excludes by content length (too short)", () => {
    const article = { url: "https://example.com", title: "Test", content: "Short" };
    const result = classifyExclusion(article);
    expect(result.excluded).toBe(true);
    expect(result.reason).toContain("too short");
  });

  test("passes valid articles", () => {
    const article = {
      url: "https://example.com",
      title: "AI Research",
      content: "A".repeat(500),
    };
    const result = classifyExclusion(article);
    expect(result.excluded).toBe(false);
  });
});

describe("cleanseMarkdownContext", () => {
  test("removes image syntax", () => {
    expect(cleanseMarkdownContext("![alt](url)")).toBe("alt");
  });

  test("removes link URLs", () => {
    expect(cleanseMarkdownContext("[text](url)")).toBe("[text]");
  });

  test("compresses whitespace", () => {
    expect(cleanseMarkdownContext("a\n\n\n\nb")).toBe("a\n\nb");
  });

  test("handles empty input", () => {
    expect(cleanseMarkdownContext("")).toBe("");
  });
});

describe("titlePassesPreScreen", () => {
  test("always passes curated items", () => {
    expect(titlePassesPreScreen("Random Title", "curated")).toBe(true);
  });

  test("passes titles with matching keywords in high-threshold purposes", () => {
    expect(titlePassesPreScreen("New Transformer Architecture", "ai_research")).toBe(true);
  });

  test("fails titles with no matching keywords in high-threshold purposes", () => {
    expect(titlePassesPreScreen("Cooking Recipe Guide", "ai_research")).toBe(false);
  });

  test("passes any title for low-threshold purposes", () => {
    expect(titlePassesPreScreen("Random Article", "business")).toBe(true);
  });
});

describe("calculatePurposeScore", () => {
  test("scores AI articles correctly", () => {
    const article = {
      url: "https://example.com",
      title: "New LLM Architecture",
      content: "This paper introduces a new transformer-based LLM architecture that achieves state-of-the-art performance on multiple NLP benchmarks. The model uses a novel attention mechanism and demonstrates significant improvements over previous approaches in both accuracy and efficiency metrics.",
    };
    const result = calculatePurposeScore(article, "ai_research");
    expect(result.isExcluded).toBe(false);
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.matchedKeywords).toContain("LLM");
  });

  test("returns 0 for unrelated content", () => {
    const article = {
      url: "https://example.com",
      title: "Cooking Recipe",
      content: "Mix flour and sugar together in a large bowl. Add eggs and vanilla extract. Stir until smooth. Preheat oven to 350 degrees Fahrenheit. Pour batter into a greased pan and bake for 25 minutes until golden brown. Let cool before serving with whipped cream.",
    };
    const result = calculatePurposeScore(article, "ai_research");
    expect(result.totalScore).toBe(0);
  });

  test("applies title multiplier", () => {
    const filler = " This is additional context to ensure the article passes content length validation checks. It provides enough text to meet the minimum character threshold required by the pipeline processing rules.";
    const titleOnly = {
      url: "https://example.com",
      title: "LLM Breakthrough",
      content: "No specific technology keywords appear in this body text." + filler,
    };
    const bodyOnly = {
      url: "https://example.com",
      title: "Some Article",
      content: "This discusses LLM technology in detail and its implications for natural language processing." + filler,
    };
    const titleResult = calculatePurposeScore(titleOnly, "ai_research");
    const bodyResult = calculatePurposeScore(bodyOnly, "ai_research");
    // Title match should score higher due to 2x multiplier
    expect(titleResult.totalScore).toBeGreaterThan(bodyResult.totalScore);
  });
});

describe("assignBestPurpose", () => {
  test("assigns correct purpose based on content", () => {
    const article = {
      url: "https://example.com",
      title: "New transformer model",
      content: "A new GPT-based LLM model was released today with SOTA benchmarks. The model demonstrates remarkable improvements across multiple evaluation criteria including reasoning, coding, and language understanding tasks. Researchers believe this could reshape the landscape of natural language processing.",
    };
    const result = assignBestPurpose(article);
    expect(result.assignedPurpose).toBe("ai_research");
  });

  test("falls back to curated for unmatched content", () => {
    const article = {
      url: "https://example.com",
      title: "Random unrelated topic",
      content: "This has nothing to do with technology or any scored categories. It is a lifestyle blog post about gardening tips for spring planting season. The author shares personal experiences growing tomatoes and herbs in their backyard garden over the past decade of practice.",
    };
    const result = assignBestPurpose(article);
    expect(result.assignedPurpose).toBe("curated");
  });
});

describe("calculateFreshnessFactor", () => {
  test("returns 1.0 for very recent articles", () => {
    const recent = new Date().toISOString();
    const factor = calculateFreshnessFactor(recent);
    expect(factor).toBeCloseTo(1.0, 1);
  });

  test("returns lower value for older articles", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const factor = calculateFreshnessFactor(old);
    expect(factor).toBeLessThan(1.0);
    expect(factor).toBeGreaterThan(0);
  });

  test("returns 1.0 for undefined publishedAt", () => {
    expect(calculateFreshnessFactor(undefined)).toBe(1.0);
  });
});
