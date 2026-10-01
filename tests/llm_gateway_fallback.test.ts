/**
 * Unit tests for LLM Gateway provider fallback: client errors are recorded and the next
 * candidate model is tried, without tripping the circuit breaker.
 */

jest.mock("../src/core/config", () => ({
  env: { GEMINI_API_KEY: "test-key" },
  config: {
    settings: {
      models: { platform: "google", map: "map-model", reduce: "reduce-model", thinking: false },
      fallback_models: undefined,
    },
  },
}));

jest.mock("../src/summarization/model_resolver", () => ({
  resolveModel: jest.fn(async (model: string) => model),
}));

const mockGenerateContent = jest.fn();
jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: ({ model }: { model: string }) => ({
      generateContent: (request: unknown) => mockGenerateContent(model, request),
    }),
  })),
}));

import { llmCall, getCircuit, isCircuitOpen, resetCircuits } from "../src/summarization/llm_gateway";
import { metrics } from "../src/core/metrics";

const clientError = (): Error =>
  Object.assign(
    new Error("[GoogleGenerativeAI Error]: [400 Bad Request] Developer instruction is not enabled for this model"),
    { status: 400 }
  );

const okResponse = (text: string) => ({
  response: {
    text: () => text,
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  },
});

describe("LLM Gateway - provider fallback", () => {
  beforeEach(() => {
    resetCircuits();
    mockGenerateContent.mockReset();
  });

  test("falls back to the other phase's model when the map model rejects the request", async () => {
    mockGenerateContent.mockImplementation(async (model: string) => {
      if (model === "map-model") throw clientError();
      return okResponse('{"facts": []}');
    });

    const response = await llmCall({ systemPrompt: "system", userPrompt: "user", phase: "map" });

    expect(response.model).toBe("reduce-model");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(
      metrics.getSnapshot().errors.some(
        (e) => e.startsWith("[map] google/map-model") && e.includes("Developer instruction is not enabled")
      )
    ).toBe(true);
  });

  test("client errors are not counted toward the circuit breaker", async () => {
    mockGenerateContent.mockImplementation(async (model: string) => {
      if (model === "map-model") throw clientError();
      return okResponse("ok");
    });

    for (let i = 0; i < 4; i++) {
      await llmCall({ systemPrompt: "system", userPrompt: "user", phase: "map" });
    }

    expect(getCircuit("google").failures).toBe(0);
    expect(isCircuitOpen("google")).toBe(false);
    // The primary model is still attempted on every call because the circuit stays closed.
    expect(mockGenerateContent.mock.calls.filter(([model]) => model === "map-model")).toHaveLength(4);
  });

  test("throws with the last error when every candidate fails", async () => {
    mockGenerateContent.mockImplementation(async () => {
      throw clientError();
    });
    const errorsBefore = metrics.getSnapshot().errors.length;

    await expect(
      llmCall({ systemPrompt: "system", userPrompt: "user", phase: "reduce" })
    ).rejects.toThrow(/All LLM providers failed for phase: reduce \(last error: google\/map-model: .*Developer instruction/);

    // Both the primary (reduce-model) and the in-provider fallback (map-model) were recorded.
    const newErrors = metrics.getSnapshot().errors.slice(errorsBefore);
    expect(newErrors).toHaveLength(2);
    expect(newErrors[0]).toContain("[reduce] google/reduce-model");
    expect(newErrors[1]).toContain("[reduce] google/map-model");
  });
});
