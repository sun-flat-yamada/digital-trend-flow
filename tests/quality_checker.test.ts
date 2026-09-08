/**
 * Item 7.2: Quality checker unit tests
 */

import { evaluateQuality } from "../src/evaluation/quality_checker";

describe("evaluateQuality", () => {
  const goodSummary = `## 🔥 本日の最重要ニュース

OpenAIが新しいGPT-5モデルを発表しました。このモデルは従来のGPT-4を大幅に上回る性能を示しています。
特にコーディングタスクにおいて、ベンチマークスコアが30%向上しました。
業界への影響は計り知れず、AIアシスタント市場の勢力図が大きく変わる可能性があります。

**出典**: [OpenAI Blog](https://openai.com/blog/gpt5) | **カテゴリ**: 🔬 AI・LLM 研究

---

## 🔬 AI・LLM 研究

1. **GPT-5リリース**: OpenAIが次世代モデルを発表
   **出典**: [OpenAI](https://openai.com/blog/gpt5)
2. **Anthropicの新手法**: Claude 4の学習に新しいRLHF手法を採用
   **出典**: [Anthropic](https://anthropic.com/research)

## 📰 その他の関連ニュース

- [Google DeepMind Update](https://deepmind.com) — 🔬 AI・LLM 研究
`;

  test("gives high score to well-formatted summary", () => {
    const result = evaluateQuality(goodSummary, [
      "https://openai.com/blog/gpt5",
      "https://anthropic.com/research",
    ]);

    expect(result.overallScore).toBeGreaterThan(70);
    expect(result.passCount).toBeGreaterThanOrEqual(4);
  });

  test("detects missing required sections", () => {
    const badSummary = "Just a plain text summary with no sections.";
    const result = evaluateQuality(badSummary, []);

    const formatCheck = result.checks.find((c) => c.name === "Format Compliance");
    expect(formatCheck?.passed).toBe(false);
  });

  test("detects non-Japanese content when target language is ja", () => {
    const englishSummary = `## 🔥 Top News\n\nThis is an English summary about AI trends.\n\n## Research\n\nMore English content here.`;
    const result = evaluateQuality(englishSummary, [], "ja");

    const langCheck = result.checks.find((c) => c.name === "Language Check");
    expect(langCheck?.passed).toBe(false);
  });

  test("validates English content by default (en)", () => {
    const englishSummary = `## 🔥 Today's Top Story

### OpenAI Announces GPT-5 with Major Breakthroughs
**Source**: [OpenAI](https://openai.com/blog/gpt5) | **Category**: 🔬 AI Research

OpenAI has officially launched GPT-5, marking a significant milestone in generative AI capabilities.
The model demonstrates unprecedented reasoning ability and sets state of the art results across multiple rigorous academic benchmarks.
Engineers and researchers around the world are evaluating its architectural advancements and efficiency improvements.

- **🚀 Technical Breakthrough / Quantitative Advance**: 35% improvement on SWE-bench coding tasks.
- **⚠️ Trade-offs & Adoption Considerations**: Higher context token cost and latency for complex queries.
- **💡 Recommended Actions for Engineers**: Conduct immediate proof-of-concept testing on internal datasets.

---

## 🔬 AI Research

1. **New Attention Architecture**: Efficient transformer variant.
   **Source**: [Research Paper](https://arxiv.org/abs/2609.0001)

## 📰 Other Relevant News

- [DeepMind Announcement](https://deepmind.com) — 🔬 AI Research
`;
    const result = evaluateQuality(englishSummary, ["https://openai.com/blog/gpt5", "https://arxiv.org/abs/2609.0001"]);

    const langCheck = result.checks.find((c) => c.name === "Language Check");
    expect(langCheck?.passed).toBe(true);

    const formatCheck = result.checks.find((c) => c.name === "Format Compliance");
    expect(formatCheck?.passed).toBe(true);

    const insightCheck = result.checks.find((c) => c.name === "Actionable Insights");
    expect(insightCheck?.passed).toBe(true);
  });

  test("validates citation coverage", () => {
    const result = evaluateQuality(goodSummary, [
      "https://openai.com/blog/gpt5",
      "https://anthropic.com/research",
      "https://missing.com/article",
      "https://also-missing.com/article",
    ]);

    const citationCheck = result.checks.find((c) => c.name === "Citation Accuracy");
    expect(citationCheck?.score).toBe(50); // 2 out of 4
  });

  test("evaluates actionable insights check", () => {
    const summaryWithInsights = `## 🔥 本日の最重要ニュース
### OpenAI GPT-5
**出典**: [OpenAI Blog](https://openai.com/blog/gpt5)
- **🚀 技術的ブレークスルー**: ベンチマーク大幅性能向上
- **⚠️ 採用・導入のトレードオフ**: 高い推論コスト
- **💡 エンジニアへの推奨アクション**: 新APIの早期検証を推奨

## 🔬 AI・LLM 研究
1. **GPT-5**: 詳細分析
   **出典**: [OpenAI](https://openai.com/blog/gpt5)
`;
    const result = evaluateQuality(summaryWithInsights, ["https://openai.com/blog/gpt5"]);
    const insightCheck = result.checks.find((c) => c.name === "Actionable Insights");
    expect(insightCheck?.passed).toBe(true);
  });
});
