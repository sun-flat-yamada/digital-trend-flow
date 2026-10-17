import { resolveModel, clearResolvedCache, isTextGenerationModel } from "../src/summarization/model_resolver";

const mockList = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { list: (params: unknown) => mockList(params) } })),
}));

/** Makes models.list return these models, the way the SDK's pager yields them. */
function mockModels(models: { name: string; supportedActions?: string[] }[]): void {
  mockList.mockResolvedValue({
    async *[Symbol.asyncIterator]() {
      yield* models;
    },
  });
}

describe("Model Resolver", () => {
  beforeEach(() => {
    clearResolvedCache();
    jest.clearAllMocks();
  });

  test("returns non-google platform models as-is", async () => {
    const result = await resolveModel("gpt-4.1-mini", "openai");
    expect(result).toBe("gpt-4.1-mini");
  });

  test("returns exact model names without auto-resolution", async () => {
    const result = await resolveModel("gemini-2.5-flash", "google");
    expect(result).toBe("gemini-2.5-flash");
  });

  test("resolves latest-flash-lite to highest flash-lite model", async () => {
    mockModels([
      { name: "models/gemini-2.0-flash-lite" },
      { name: "models/gemini-2.5-flash-lite" },
      { name: "models/gemini-3.1-flash-lite" },
      { name: "models/gemini-3.8-flash" },
    ]);

    const result = await resolveModel("latest-flash-lite", "google");
    expect(result).toBe("gemini-3.1-flash-lite");
  });

  test("resolves cost-effective and cheapest aliases to flash-lite", async () => {
    mockModels([{ name: "models/gemini-2.5-flash-lite" }, { name: "models/gemini-3.1-flash-lite" }]);

    const resultCostEffective = await resolveModel("cost-effective", "google");
    expect(resultCostEffective).toBe("gemini-3.1-flash-lite");

    clearResolvedCache();
    const resultCheapest = await resolveModel("cheapest", "google");
    expect(resultCheapest).toBe("gemini-3.1-flash-lite");
  });

  test("resolves latest-flash to highest base flash model excluding lite", async () => {
    mockModels([
      { name: "models/gemini-2.5-flash" },
      { name: "models/gemini-3.1-flash-lite" },
      { name: "models/gemini-3.8-flash" },
      { name: "models/gemini-3.8-flash-exp" }, // should be excluded
    ]);

    const result = await resolveModel("latest-flash", "google");
    expect(result).toBe("gemini-3.8-flash");
  });

  test("skips speech, image, audio and Live variants when resolving latest-flash-lite", async () => {
    // Reproduces the 2026-09-23 incident: a TTS-only model outranked the text model by version
    // and every Map call failed with "400 Developer instruction is not enabled for this model".
    mockModels([
      { name: "models/gemini-3.5-flash-lite", supportedActions: ["generateContent", "countTokens"] },
      { name: "models/gemini-3.8-flash-lite-tts", supportedActions: ["generateContent", "countTokens"] },
      { name: "models/gemini-3.8-flash-lite-image", supportedActions: ["generateContent"] },
      { name: "models/gemini-3.8-flash-lite-native-audio", supportedActions: ["generateContent"] },
      { name: "models/gemini-3.8-flash-lite-live", supportedActions: ["bidiGenerateContent"] },
    ]);

    const result = await resolveModel("latest-flash-lite", "google");
    expect(result).toBe("gemini-3.5-flash-lite");
  });

  test("skips models that do not support generateContent", async () => {
    mockModels([
      { name: "models/gemini-3.5-flash", supportedActions: ["generateContent"] },
      { name: "models/gemini-3.9-flash", supportedActions: ["countTokens"] },
    ]);

    const result = await resolveModel("latest-flash", "google");
    expect(result).toBe("gemini-3.5-flash");
  });

  test("isTextGenerationModel classifies model variants", () => {
    expect(isTextGenerationModel({ name: "models/gemini-3.5-flash-lite" })).toBe(true);
    expect(isTextGenerationModel({ name: "models/gemini-2.5-flash-lite-preview-09-2025" })).toBe(true);
    expect(isTextGenerationModel({ name: "models/gemini-3.8-flash-lite-tts" })).toBe(false);
    expect(isTextGenerationModel({ name: "models/gemini-2.5-flash-preview-native-audio-dialog" })).toBe(false);
    expect(isTextGenerationModel({ name: "models/gemini-2.0-flash-preview-image-generation" })).toBe(false);
    expect(isTextGenerationModel({ name: "models/gemini-embedding-001" })).toBe(false);
    expect(isTextGenerationModel({ name: "models/gemini-3.5-flash", supportedActions: ["embedContent"] })).toBe(false);
  });

  test("asks the SDK for every model in one page and falls back when the list is empty", async () => {
    mockModels([]);

    expect(await resolveModel("latest-flash", "google")).toBe("gemini-3.8-flash");
    expect(mockList).toHaveBeenCalledWith({ config: { pageSize: 1000 } });
  });

  test("falls back gracefully when API returns error", async () => {
    mockList.mockRejectedValue(new Error("API network failure"));

    const flashLiteFallback = await resolveModel("latest-flash-lite", "google");
    expect(flashLiteFallback).toBe("gemini-3.1-flash-lite");

    clearResolvedCache();
    const flashFallback = await resolveModel("latest-flash", "google");
    expect(flashFallback).toBe("gemini-3.8-flash");

    clearResolvedCache();
    const proFallback = await resolveModel("latest-pro", "google");
    expect(proFallback).toBe("gemini-2.5-pro");
  });
});
