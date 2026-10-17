/**
 * Tests for the LLM gateway's external providers, retries and circuit breaker in llmCall():
 * the candidate order (primary, other Google model, fallback provider), the OpenAI and Anthropic
 * request formats, retry and abort decisions, and skipping a provider whose circuit is open.
 */

import axios from "axios";

const mockEnv: Record<string, string | undefined> = { GEMINI_API_KEY: "test-key" };
jest.mock("../src/core/config", () => ({
  env: new Proxy({}, { get: (_t, key: string) => mockEnv[key] }),
  config: {
    settings: {
      models: { platform: "google", map: "map-model", reduce: "reduce-model", thinking: false },
      fallback_models: { platform: "openai", map: "gpt-4.1-mini", reduce: "gpt-4.1" },
    },
  },
}));
jest.mock("../src/summarization/model_resolver", () => ({
  resolveModel: jest.fn(async (model: string) => model),
}));

const mockGenerateContent = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: (params: { model: string }) => mockGenerateContent(params.model, params),
    },
  })),
}));

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

import {
  CIRCUIT_COOLDOWN_MS,
  callProviderWithRetry,
  getCircuit,
  isCircuitOpen,
  llmCall,
  recordFailure,
  resetCircuits,
} from "../src/summarization/llm_gateway";

const outage = () => Object.assign(new Error("[503 Service Unavailable] The model is overloaded"), { status: 503 });
const geminiOk = (text: string) => ({ text, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
const request = { systemPrompt: "system", userPrompt: "user", phase: "map" as const };

// The pipeline's schemas use Gemini's OpenAPI subset (upper-case types, see prompts.ts) ...
const MAP_SCHEMA = {
  type: "OBJECT",
  properties: {
    facts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING", description: "A fact" }, importance: { type: "INTEGER" } },
        required: ["text", "importance"],
      },
    },
  },
  required: ["facts"],
};
// ... which OpenAI and Anthropic receive as JSON Schema.
const MAP_JSON_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string", description: "A fact" }, importance: { type: "integer" } },
        required: ["text", "importance"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
};

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());
beforeEach(() => {
  resetCircuits();
  mockGenerateContent.mockReset();
  mockedAxios.post.mockReset();
  mockEnv["OPENAI_API_KEY"] = "openai-key";
  delete mockEnv["ANTHROPIC_API_KEY"];
});
afterEach(() => jest.useRealTimers());

describe("llmCall candidate order", () => {
  test("falls back to the external provider after both Google models fail, and sends structured output", async () => {
    mockGenerateContent.mockRejectedValue(Object.assign(new Error("[400 Bad Request] bad"), { status: 400 }));
    mockedAxios.post.mockResolvedValue({
      data: { choices: [{ message: { content: '{"facts":[]}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
    });

    const response = await llmCall({ ...request, responseSchema: MAP_SCHEMA, temperature: 0.1 });

    expect(mockGenerateContent.mock.calls.map(([model]) => model)).toEqual(["map-model", "reduce-model"]);
    expect(response).toMatchObject({ provider: "openai", model: "gpt-4.1-mini", text: '{"facts":[]}', inputTokens: 7 });
    const [url, body, options] = mockedAxios.post.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(body).toMatchObject({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "user" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_output", schema: MAP_JSON_SCHEMA, strict: true },
      },
    });
    expect(options).toMatchObject({ headers: { Authorization: "Bearer openai-key" } });
  });

  test("sends the system prompt, the timeout and the response schema to Gemini", async () => {
    mockGenerateContent.mockResolvedValue(geminiOk('{"facts":[]}'));

    const response = await llmCall({
      ...request,
      responseSchema: { type: "OBJECT" },
      temperature: 0.1,
      maxOutputTokens: 256,
    });

    expect(response).toMatchObject({ provider: "google", model: "map-model", inputTokens: 10, outputTokens: 5 });
    expect(mockGenerateContent.mock.calls[0]?.[1]).toEqual({
      model: "map-model",
      contents: "user",
      config: {
        systemInstruction: "system",
        httpOptions: { timeout: 180_000 },
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT" },
        temperature: 0.1,
        maxOutputTokens: 256,
      },
    });
  });

  test("a response without text is returned as empty text", async () => {
    mockGenerateContent.mockResolvedValue({ text: undefined });

    await expect(llmCall(request)).resolves.toMatchObject({ text: "", inputTokens: 0, outputTokens: 0 });
  });

  test("a per-call model overrides only the primary candidate", async () => {
    mockGenerateContent.mockResolvedValue(geminiOk("ok"));

    const response = await llmCall({ ...request, model: "triage-model" });

    expect(response.model).toBe("triage-model");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test("skips a model whose circuit is open, and lets it back in after the cooldown", async () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("google/map-model", outage());
      recordFailure("google/reduce-model", outage());
    }
    expect(isCircuitOpen("google/map-model")).toBe(true);
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: "from openai" } }] } });

    await expect(llmCall(request)).resolves.toMatchObject({ provider: "openai", text: "from openai" });
    expect(mockGenerateContent).not.toHaveBeenCalled();

    getCircuit("google/map-model").lastFailure = Date.now() - CIRCUIT_COOLDOWN_MS - 1;
    mockGenerateContent.mockResolvedValue(geminiOk("from gemini"));
    await expect(llmCall(request)).resolves.toMatchObject({ provider: "google", text: "from gemini" });
    expect(getCircuit("google/map-model").isOpen).toBe(false);
  });

  test("an overloaded model opens only its own circuit, not the other models of its platform", async () => {
    mockGenerateContent.mockImplementation(async (model: string) => {
      if (model === "map-model") throw outage();
      return geminiOk(`from ${model}`);
    });
    jest.useFakeTimers();

    for (let i = 0; i < 3; i++) {
      const pending = llmCall(request);
      await jest.advanceTimersByTimeAsync(120_000); // the retries' backoff
      await expect(pending).resolves.toMatchObject({ provider: "google", model: "reduce-model" });
    }

    expect(isCircuitOpen("google/map-model")).toBe(true);
    expect(isCircuitOpen("google/reduce-model")).toBe(false);
    // With the map model's circuit open, the next call goes straight to the other Google model.
    mockGenerateContent.mockClear();
    await expect(llmCall(request)).resolves.toMatchObject({ model: "reduce-model" });
    expect(mockGenerateContent.mock.calls.map(([model]) => model)).toEqual(["reduce-model"]);
  });

  test("reports when every candidate was skipped by its circuit breaker", async () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("google/map-model", outage());
      recordFailure("google/reduce-model", outage());
      recordFailure("openai/gpt-4.1-mini", outage());
    }

    await expect(llmCall(request)).rejects.toThrow(
      "All LLM providers failed for phase: map (last error: every provider was skipped by its circuit breaker)",
    );
  });

  test("a missing fallback key is recorded as that candidate's failure", async () => {
    delete mockEnv["OPENAI_API_KEY"];
    mockGenerateContent.mockRejectedValue(Object.assign(new Error("[401 Unauthorized]"), { status: 401 }));

    await expect(llmCall(request)).rejects.toThrow(/last error: openai\/gpt-4.1-mini: OPENAI_API_KEY not set/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe("callProviderWithRetry", () => {
  test("retries a transient error with backoff and returns the later success", async () => {
    jest.useFakeTimers();
    mockGenerateContent.mockRejectedValueOnce(outage()).mockResolvedValueOnce(geminiOk("second try"));

    const pending = callProviderWithRetry({ platform: "google", model: "map-model" }, request);
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toMatchObject({ text: "second try" });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  test("does not retry a client error or a quota of 0", async () => {
    mockGenerateContent.mockRejectedValueOnce(Object.assign(new Error("[403 Forbidden]"), { status: 403 }));
    await expect(callProviderWithRetry({ platform: "google", model: "map-model" }, request)).rejects.toThrow(
      "[403 Forbidden]",
    );

    mockGenerateContent.mockRejectedValueOnce(new Error("[429 Too Many Requests] Quota exceeded, limit: 0"));
    await expect(callProviderWithRetry({ platform: "google", model: "reduce-model" }, request)).rejects.toThrow(
      /limit: 0/,
    );

    mockGenerateContent.mockRejectedValueOnce(new Error("Unexpected token < in JSON"));
    await expect(callProviderWithRetry({ platform: "google", model: "map-model" }, request)).rejects.toThrow(
      "Unexpected token",
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  test("calls Anthropic's Messages API with its version header", async () => {
    mockEnv["ANTHROPIC_API_KEY"] = "anthropic-key";
    mockedAxios.post.mockResolvedValue({
      data: { content: [{ type: "text", text: "from claude" }], usage: { input_tokens: 11, output_tokens: 4 } },
    });

    const response = await callProviderWithRetry(
      { platform: "anthropic", model: "claude-haiku-4" },
      { ...request, maxOutputTokens: 512 },
    );

    expect(response).toMatchObject({ provider: "anthropic", text: "from claude", inputTokens: 11, outputTokens: 4 });
    const [url, body, options] = mockedAxios.post.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body).toMatchObject({ model: "claude-haiku-4", system: "system", max_tokens: 512 });
    expect(body).not.toHaveProperty("tools");
    expect(options).toMatchObject({ headers: { "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" } });
  });

  test("asks Anthropic for structured output through a forced tool call and returns its input as JSON", async () => {
    mockEnv["ANTHROPIC_API_KEY"] = "anthropic-key";
    const facts = { facts: [{ text: "A fact", importance: 8 }] };
    mockedAxios.post.mockResolvedValue({
      data: {
        content: [{ type: "tool_use", id: "toolu_1", name: "structured_output", input: facts }],
        usage: { input_tokens: 20, output_tokens: 9 },
      },
    });

    const response = await callProviderWithRetry(
      { platform: "anthropic", model: "claude-haiku-4" },
      { ...request, responseSchema: MAP_SCHEMA },
    );

    expect(JSON.parse(response.text)).toEqual(facts);
    expect(mockedAxios.post.mock.calls[0]?.[1]).toMatchObject({
      tools: [{ name: "structured_output", input_schema: MAP_JSON_SCHEMA }],
      tool_choice: { type: "tool", name: "structured_output" },
    });
  });

  test("OpenAI gets strict mode only when every property is required", async () => {
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: "{}" } }] } });
    const optionalField = {
      type: "OBJECT",
      properties: { a: { type: "STRING" }, b: { type: "STRING" } },
      required: ["a"],
    };

    await callProviderWithRetry(
      { platform: "openai", model: "gpt-4.1" },
      { ...request, responseSchema: optionalField },
    );

    expect(mockedAxios.post.mock.calls[0]?.[1]).toMatchObject({
      response_format: {
        json_schema: {
          strict: false,
          schema: {
            type: "object",
            properties: { a: { type: "string" }, b: { type: "string" } },
            required: ["a"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  test("rejects an unknown platform", async () => {
    await expect(callProviderWithRetry({ platform: "mystery", model: "m" }, request)).rejects.toThrow(
      "Unknown platform: mystery",
    );
  });
});
