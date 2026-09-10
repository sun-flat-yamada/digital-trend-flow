import { resolveModel, clearResolvedCache } from "../src/summarization/model_resolver";

describe("Model Resolver", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearResolvedCache();
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "models/gemini-2.0-flash-lite" },
          { name: "models/gemini-2.5-flash-lite" },
          { name: "models/gemini-3.1-flash-lite" },
          { name: "models/gemini-3.8-flash" },
        ],
      }),
    } as any);

    const result = await resolveModel("latest-flash-lite", "google");
    expect(result).toBe("gemini-3.1-flash-lite");
  });

  test("resolves cost-effective and cheapest aliases to flash-lite", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "models/gemini-2.5-flash-lite" },
          { name: "models/gemini-3.1-flash-lite" },
        ],
      }),
    } as any);

    const resultCostEffective = await resolveModel("cost-effective", "google");
    expect(resultCostEffective).toBe("gemini-3.1-flash-lite");

    clearResolvedCache();
    const resultCheapest = await resolveModel("cheapest", "google");
    expect(resultCheapest).toBe("gemini-3.1-flash-lite");
  });

  test("resolves latest-flash to highest base flash model excluding lite", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "models/gemini-2.5-flash" },
          { name: "models/gemini-3.1-flash-lite" },
          { name: "models/gemini-3.8-flash" },
          { name: "models/gemini-3.8-flash-exp" }, // should be excluded
        ],
      }),
    } as any);

    const result = await resolveModel("latest-flash", "google");
    expect(result).toBe("gemini-3.8-flash");
  });

  test("falls back gracefully when API returns error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("API network failure"));

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
