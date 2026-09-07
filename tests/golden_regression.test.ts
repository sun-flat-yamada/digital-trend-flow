/**
 * Item 7.1: Golden dataset regression test.
 * Validates scoring logic against a known set of articles with expected outcomes.
 */

import * as fs from "fs";
import * as path from "path";
import {
  calculatePurposeScore,
  assignBestPurpose,
  excludeByMetadata,
} from "../src/filtering/scorer";

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
            { word: "fine-tuning", weight: 6 },
            { word: "benchmark", weight: 4 },
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
            { word: "revenue", weight: 6 },
            { word: "billion", weight: 5 },
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
      url_strip_parameters: ["utm_source"],
      keywords: ["PR:", "Sponsored"],
      content_length: { min: 100, max: 50000 },
    },
    settings: {
      daily_threshold_score: 0,
      freshness: { enabled: false, decay_lambda: 0.02, max_age_hours: 72 },
      llm_judge: { enabled: false, weight: 0.5 },
      semantic_dedup: { enabled: false, similarity_threshold: 0.92 },
    },
  },
  env: { GEMINI_API_KEY: "test" },
}));

interface GoldenEntry {
  title: string;
  url: string;
  content: string;
  expectedPurpose?: string;
  expectedMinScore?: number;
  expectedKeywords?: string[];
  expectedIsExcluded?: boolean;
  expectedExclusionReason?: string;
}

const goldenData: GoldenEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, "golden", "golden_dataset.json"), "utf8")
);

describe("Golden Dataset Regression", () => {
  for (const entry of goldenData) {
    if (entry.expectedIsExcluded) {
      test(`should exclude: "${entry.title}"`, () => {
        const result = excludeByMetadata(entry.title, entry.url);
        expect(result.excluded).toBe(true);
        if (entry.expectedExclusionReason) {
          expect(result.reason).toContain(entry.expectedExclusionReason);
        }
      });
    } else {
      test(`should score correctly: "${entry.title}"`, () => {
        const article = {
          url: entry.url,
          title: entry.title,
          content: entry.content,
        };
        const result = assignBestPurpose(article);

        // Purpose assignment check
        if (entry.expectedPurpose) {
          expect(result.assignedPurpose).toBe(entry.expectedPurpose);
        }

        // Minimum score check
        if (entry.expectedMinScore !== undefined) {
          expect(result.totalScore).toBeGreaterThanOrEqual(entry.expectedMinScore);
        }

        // Keyword presence check
        if (entry.expectedKeywords) {
          for (const kw of entry.expectedKeywords) {
            expect(result.matchedKeywords).toContain(kw);
          }
        }
      });
    }
  }
});
