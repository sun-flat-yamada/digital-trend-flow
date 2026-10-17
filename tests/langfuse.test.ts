/**
 * Tests for the Langfuse integration: the run trace becomes the active trace, generations are
 * sent with usage and cost details, and the gateway records one generation per successful call.
 */

const mockGeneration = jest.fn();
const mockEvent = jest.fn();
const mockTrace = jest.fn((body: unknown) => ({
  body,
  generation: mockGeneration,
  event: mockEvent,
  score: jest.fn(),
}));
jest.mock("langfuse", () => ({
  Langfuse: jest.fn().mockImplementation(() => ({ trace: mockTrace, shutdownAsync: jest.fn(async () => undefined) })),
}));
jest.mock("../src/core/config", () => ({
  env: { GEMINI_API_KEY: "test-key", LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" },
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
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: async ({ model }: { model: string }) => ({
        text: `answer from ${model}`,
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
      }),
    },
  })),
}));

import { initLangfuse, createTrace, getActiveTrace, recordEvent, flushLangfuse } from "../src/core/langfuse";
import { llmCall } from "../src/summarization/llm_gateway";
import { promptHash } from "../src/summarization/prompts";

describe("langfuse", () => {
  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    initLangfuse();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test("createTrace makes the trace active", () => {
    const trace = createTrace("run-1", "2026-10-17", "weekly-report-2026-W42");
    expect(trace).not.toBeNull();
    expect(getActiveTrace()).toBe(trace);
    expect(mockTrace).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", name: "weekly-report-2026-W42" }));
  });

  test("llmCall records a generation span with usage, cost and prompt hash", async () => {
    createTrace("run-2", "2026-10-17");
    mockGeneration.mockClear();

    await llmCall({ systemPrompt: "system prompt", userPrompt: "user prompt", phase: "reduce" });

    expect(mockGeneration).toHaveBeenCalledTimes(1);
    const body = mockGeneration.mock.calls[0]![0];
    expect(body).toMatchObject({
      name: "llm:reduce",
      model: "reduce-model",
      input: "user prompt",
      output: "answer from reduce-model",
      usageDetails: { input: 100, output: 20, total: 120 },
      metadata: { promptVersion: promptHash("system prompt"), provider: "google" },
    });
    expect(typeof body.costDetails.total).toBe("number");
    expect(body.endTime.getTime()).toBeGreaterThanOrEqual(body.startTime.getTime());
  });

  test("recordEvent attaches an event to the trace", () => {
    const trace = createTrace("run-3", "2026-10-17");
    recordEvent(trace, "map:complete", { factCount: 3 });
    expect(mockEvent).toHaveBeenCalledWith({ name: "map:complete", metadata: { factCount: 3 } });
  });

  test("flushLangfuse clears the active trace", async () => {
    createTrace("run-4", "2026-10-17");
    await flushLangfuse();
    expect(getActiveTrace()).toBeNull();
  });
});
