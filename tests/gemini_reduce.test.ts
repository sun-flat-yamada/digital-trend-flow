/**
 * Unit tests for the Reduce phase result: the caller must be able to tell a real summary
 * from the raw-facts fallback, which is never published.
 */

jest.mock("../src/core/config", () => ({ config: {}, env: {} }));

const mockLlmCall = jest.fn();
jest.mock("../src/summarization/llm_gateway", () => ({
  llmCall: (...args: unknown[]) => mockLlmCall(...args),
}));

import { reduceSummarize } from "../src/summarization/gemini_reduce";

const facts = [
  {
    source_title: "Example article",
    source_url: "https://example.com/a",
    facts: [{ text: "Example fact", importance: 8 }],
    purpose: "ai_research",
    purposeLabel: "🔬 AI・LLM 研究",
    score: 12,
  },
];
const purposes = [{ key: "ai_research", label: "🔬 AI・LLM 研究" }];

describe("reduceSummarize", () => {
  beforeEach(() => {
    mockLlmCall.mockReset();
  });

  test("returns the LLM summary when the call succeeds", async () => {
    mockLlmCall.mockResolvedValue({ text: "## 🔥 Today's Top Story\n\nSummary" });

    const result = await reduceSummarize(facts, "2026-10-01", purposes, "en");

    expect(result).toEqual({ markdown: "## 🔥 Today's Top Story\n\nSummary", usedFallback: false });
  });

  test("flags the raw-facts fallback when the call fails", async () => {
    mockLlmCall.mockRejectedValue(new Error("All LLM providers failed for phase: reduce"));

    const result = await reduceSummarize(facts, "2026-10-01", purposes, "en");

    expect(result.usedFallback).toBe(true);
    expect(result.markdown).toContain("Fallback Mode");
    expect(result.markdown).toContain("Example fact");
  });
});
