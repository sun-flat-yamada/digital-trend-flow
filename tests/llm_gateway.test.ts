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
} from "../src/summarization/llm_gateway";

describe("LLM Gateway - Error Classification", () => {
  test("correctly identifies 429 rate limit errors", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ response: { status: 429 } })).toBe(true);
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
    expect(
      isRateLimitError(
        new Error("[429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.")
      )
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
    expect(isTransientError(new Error("[503 Service Unavailable] This model is currently experiencing high demand"))).toBe(true);
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
      "[429 Too Many Requests] Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro"
    );
    expect(isRateLimitError(errorWithLimit0)).toBe(true);
    expect(isTransientError(errorWithLimit0)).toBe(true);
  });
});
