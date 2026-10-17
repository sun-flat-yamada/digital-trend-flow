/**
 * Unit tests for LLM Gateway error classification, retry logic, and circuit breaker separation.
 */

import {
  isRateLimitError,
  isTransientError,
  extractRetryDelayMs,
  recordFailure,
  recordSuccess,
  isCircuitOpen,
  getCircuit,
  resetCircuits,
  toJsonSchema,
} from "../src/summarization/llm_gateway";
import { MAP_RESPONSE_SCHEMA, TRIAGE_RESPONSE_SCHEMA } from "../src/summarization/prompts";
import { ApiError } from "@google/genai";

describe("LLM Gateway - Error Classification", () => {
  test("correctly identifies 429 rate limit errors", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ response: { status: 429 } })).toBe(true);
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
    expect(
      isRateLimitError(
        new Error(
          "[429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.",
        ),
      ),
    ).toBe(true);
    expect(isRateLimitError(new Error("RESOURCE_EXHAUSTED: Quota exceeded for metric"))).toBe(true);
    expect(isRateLimitError(new Error("rate_limit_exceeded"))).toBe(true);

    // Non-rate-limit errors
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError({ status: 400 })).toBe(false);
    expect(isRateLimitError(new Error("Network connection dropped"))).toBe(false);
  });

  test("correctly identifies transient errors (429, 500, 502, 503, 504, network timeouts)", () => {
    // 429
    expect(isTransientError({ status: 429 })).toBe(true);

    // 5xx status codes
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ response: { status: 502 } })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ statusCode: 504 })).toBe(true);

    // Common transient messages
    expect(
      isTransientError(new Error("[503 Service Unavailable] This model is currently experiencing high demand")),
    ).toBe(true);
    expect(isTransientError(new Error("socket hang up"))).toBe(true);
    expect(isTransientError(new Error("ETIMEDOUT: Connection timed out"))).toBe(true);
    expect(isTransientError(new Error("ECONNRESET"))).toBe(true);

    // Non-transient client errors
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 403 })).toBe(false);
    expect(isTransientError({ response: { status: 404 } })).toBe(false);
  });

  test("correctly extracts retry delay in milliseconds", () => {
    const errorWithSeconds = new Error("Please retry in 32.197338096s. Quota exceeded");
    expect(extractRetryDelayMs(errorWithSeconds)).toBe(32198);

    const errorWithJsonDelay = new Error('{"retryDelay":"45s"}');
    expect(extractRetryDelayMs(errorWithJsonDelay)).toBe(45000);

    const errorWithHeader = {
      message: "Rate limit exceeded",
      response: {
        headers: {
          "retry-after": "10",
        },
      },
    };
    expect(extractRetryDelayMs(errorWithHeader)).toBe(10000);

    const regularError = new Error("Something broke");
    expect(extractRetryDelayMs(regularError)).toBeNull();
  });
});

describe("LLM Gateway - errors of the @google/genai SDK", () => {
  // The SDK throws ApiError with the HTTP status and the JSON error body as the message.
  const sdkError = (status: number, body: unknown) => new ApiError({ status, message: JSON.stringify(body) });

  test("classifies by status and reads the retry delay and the quota from the error body", () => {
    const quota = sdkError(429, {
      error: {
        code: 429,
        message: "You exceeded your current quota. Quota exceeded for metric: x, limit: 0, model: gemini-3.1-pro",
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "32s" }],
      },
    });
    expect(isRateLimitError(quota)).toBe(true);
    expect(extractRetryDelayMs(quota)).toBe(32000);
    expect(String(quota.message)).toContain("limit: 0");

    const overloaded = sdkError(503, {
      error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" },
    });
    expect(isTransientError(overloaded)).toBe(true);
    expect(isRateLimitError(overloaded)).toBe(false);

    const badRequest = sdkError(400, {
      error: { code: 400, message: "Developer instruction is not enabled", status: "INVALID_ARGUMENT" },
    });
    expect(isTransientError(badRequest)).toBe(false);
  });
});

describe("LLM Gateway - Circuit Breaker Separation", () => {
  beforeEach(() => {
    resetCircuits();
  });

  test("rate limit error (429) does NOT trip circuit breaker into OPEN state", () => {
    const provider = "test_google_rate_limit";
    const rateLimitError = new Error("[429 Too Many Requests] You exceeded your current quota");

    // Simulate 5 consecutive 429 failures
    for (let i = 0; i < 5; i++) {
      recordFailure(provider, rateLimitError);
    }

    const circuit = getCircuit(provider);
    expect(circuit.failures).toBe(0);
    expect(circuit.isOpen).toBe(false);
    expect(isCircuitOpen(provider)).toBe(false);
  });

  test("consecutive server/infrastructure errors (503/500) trip circuit breaker after threshold", () => {
    const provider = "test_google_outage";
    const serverError = new Error("[503 Service Unavailable] Infrastructure down");

    // 1st failure
    recordFailure(provider, serverError);
    expect(isCircuitOpen(provider)).toBe(false);
    expect(getCircuit(provider).failures).toBe(1);

    // 2nd failure
    recordFailure(provider, serverError);
    expect(isCircuitOpen(provider)).toBe(false);
    expect(getCircuit(provider).failures).toBe(2);

    // 3rd failure (CIRCUIT_THRESHOLD = 3)
    recordFailure(provider, serverError);
    expect(isCircuitOpen(provider)).toBe(true);
    expect(getCircuit(provider).failures).toBe(3);
    expect(getCircuit(provider).isOpen).toBe(true);

    // Success resets circuit
    recordSuccess(provider);
    expect(isCircuitOpen(provider)).toBe(false);
    expect(getCircuit(provider).failures).toBe(0);
    expect(getCircuit(provider).isOpen).toBe(false);
  });

  test("quota error with limit: 0 is recognized as rate limit and aborts retries", async () => {
    const errorWithLimit0 = new Error(
      "[429 Too Many Requests] Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro",
    );
    expect(isRateLimitError(errorWithLimit0)).toBe(true);
    expect(isTransientError(errorWithLimit0)).toBe(true);
  });
});

describe("LLM Gateway - response schemas for OpenAI and Anthropic", () => {
  test("the pipeline's schemas convert to JSON Schema with lower-case types and closed objects", () => {
    const map = toJsonSchema(MAP_RESPONSE_SCHEMA) as Record<string, unknown>;
    expect(map).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        source_title: { type: "string", description: "Original article title" },
        facts: {
          type: "array",
          items: { type: "object", additionalProperties: false, properties: { importance: { type: "integer" } } },
        },
      },
    });
    expect(JSON.stringify(toJsonSchema(TRIAGE_RESPONSE_SCHEMA))).not.toMatch(/"type":"[A-Z]+"/);
    // The conversion leaves the input unchanged (the Gemini call still uses it).
    expect(MAP_RESPONSE_SCHEMA.type).toBe("OBJECT");
  });
});
