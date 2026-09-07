/**
 * Item 2.4: Semantic dedup tests
 */

import { semanticDedup } from "../src/filtering/semantic_dedup";

jest.mock("../src/core/config", () => ({
  config: {
    settings: {
      semantic_dedup: { enabled: true, similarity_threshold: 0.6 },
    },
  },
}));

describe("semanticDedup", () => {
  test("removes near-duplicate titles", () => {
    const articles = [
      { url: "https://a.com", title: "OpenAI releases GPT-5 with amazing capabilities", score: 20, purpose: "ai" },
      { url: "https://b.com", title: "OpenAI releases GPT-5 with incredible capabilities", score: 15, purpose: "ai" },
      { url: "https://c.com", title: "Google announces new quantum computer breakthrough", score: 10, purpose: "ai" },
    ];

    const result = semanticDedup(articles);
    expect(result.length).toBe(2);
    // Higher-scored duplicate should be kept
    expect(result.find((a) => a.url === "https://a.com")).toBeTruthy();
    expect(result.find((a) => a.url === "https://c.com")).toBeTruthy();
  });

  test("removes near-duplicate Japanese titles", () => {
    const articles = [
      { url: "https://ja-a.com", title: "OpenAIが次世代モデル「GPT-5」を電撃発表、推論性能が劇的に進化", score: 25, purpose: "ai" },
      { url: "https://ja-b.com", title: "【速報】OpenAIが次世代モデル「GPT-5」を発表！推論性能が劇的進化", score: 18, purpose: "ai" },
      { url: "https://ja-c.com", title: "Googleが量子コンピューティングの新マイルストーンを達成", score: 12, purpose: "ai" },
    ];

    const result = semanticDedup(articles);
    expect(result.length).toBe(2);
    // Higher-scored duplicate kept
    expect(result.find((a) => a.url === "https://ja-a.com")).toBeTruthy();
    expect(result.find((a) => a.url === "https://ja-c.com")).toBeTruthy();
  });

  test("keeps all unique articles", () => {
    const articles = [
      { url: "https://a.com", title: "AI breakthrough in healthcare", score: 20, purpose: "ai" },
      { url: "https://b.com", title: "New quantum computing milestone", score: 15, purpose: "ai" },
      { url: "https://c.com", title: "Climate change policy update", score: 10, purpose: "geo" },
    ];

    const result = semanticDedup(articles);
    expect(result.length).toBe(3);
  });
});
