/**
 * Unit tests for the Map phase: failures propagate instead of producing placeholder facts,
 * and citations always come from the pipeline rather than from the model's output.
 */

jest.mock("../src/core/config", () => ({ config: {}, env: {} }));

const mockLlmCall = jest.fn();
jest.mock("../src/summarization/llm_gateway", () => ({
  llmCall: (...args: unknown[]) => mockLlmCall(...args),
}));

import { mapExtractFacts } from "../src/summarization/gemini_map";

const llmResponse = (text: string) => ({
  text,
  model: "test-model",
  provider: "google",
  inputTokens: 10,
  outputTokens: 5,
  latencyMs: 1,
});

// Each test uses its own URL so the in-memory fact cache never serves a previous result.
const article = (id: string) => ({
  title: `Article ${id}`,
  url: `https://example.com/articles/${id}`,
  content: `Body of article ${id}. `.repeat(20),
});

describe("mapExtractFacts", () => {
  beforeEach(() => {
    mockLlmCall.mockReset();
  });

  test("keeps well-formed facts and takes the citation from the pipeline", async () => {
    mockLlmCall.mockResolvedValue(
      llmResponse(
        JSON.stringify({
          source_title: "Title rewritten by the model",
          source_url: "https://wrong.example.com/",
          facts: [
            { text: "Fact A", importance: 7 },
            { text: "   ", importance: 3 },
            { importance: 5 },
          ],
        })
      )
    );

    const result = await mapExtractFacts(article("ok"));

    expect(result.source_title).toBe("Article ok");
    expect(result.source_url).toBe("https://example.com/articles/ok");
    expect(result.facts).toEqual([{ text: "Fact A", importance: 7 }]);
  });

  test("propagates LLM failures instead of returning a placeholder fact", async () => {
    mockLlmCall.mockRejectedValue(new Error("All LLM providers failed for phase: map"));

    await expect(mapExtractFacts(article("llm-failure"))).rejects.toThrow("All LLM providers failed");
  });

  test("rejects a response that is not JSON", async () => {
    mockLlmCall.mockResolvedValue(llmResponse("Sorry, I cannot help with that."));

    await expect(mapExtractFacts(article("not-json"))).rejects.toThrow();
  });

  test("rejects a response without usable facts", async () => {
    mockLlmCall.mockResolvedValue(llmResponse(JSON.stringify({ facts: [] })));

    await expect(mapExtractFacts(article("no-facts"))).rejects.toThrow("no usable facts");
  });
});
