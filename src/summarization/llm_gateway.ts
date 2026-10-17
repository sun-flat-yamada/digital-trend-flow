/**
 * [Role] Multi-provider LLM gateway with automatic fallback.
 * [Mechanism] Wraps Google Gemini, OpenAI, and Anthropic APIs behind a
 * unified interface. Implements circuit breaker pattern for resilience.
 *
 * Items: 1.1 Structured Output, 1.2 Multi-LLM Fallback, 1.4 Thinking Model
 */

import type { GenerateContentConfig, Schema } from "@google/genai";
import axios from "axios";
import pRetry, { AbortError } from "../core/retry";
import { env, config } from "../core/config";
import { metrics, estimateCost } from "../core/metrics";
import type { LLMCallMetrics } from "../core/metrics";
import { resolveModel } from "./model_resolver";
import { geminiClient } from "./gemini_client";
import { asErrorLike, errorMessage, toError } from "../core/errors";

// ── Types ──

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  phase: LLMCallMetrics["phase"];
  model?: string; // overrides the primary provider's model for this call (e.g. settings.triage.model)
  responseSchema?: Record<string, unknown>; // Item 1.1: Structured Output
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

// ── Error Classification & Utilities ──

export function isRateLimitError(error: unknown): boolean {
  const e = asErrorLike(error);
  const status = e.status ?? e.response?.status ?? e.statusCode;
  if (status === 429) return true;
  const msg = String(e.message || "");
  return (
    msg.includes("429") ||
    msg.includes("Too Many Requests") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("Quota exceeded") ||
    msg.includes("quota") ||
    msg.includes("rate-limit") ||
    msg.includes("rate_limit_exceeded")
  );
}

export function isTransientError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  const e = asErrorLike(error);
  const status = e.status ?? e.response?.status ?? e.statusCode;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(e.message || "");
  return (
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("Service Unavailable") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNABORTED") ||
    msg.includes("socket hang up") ||
    msg.includes("network timeout")
  );
}

export function extractRetryDelayMs(error: unknown): number | null {
  const e = asErrorLike(error);
  const msg = String(e.message || "");
  // Check "Please retry in 32.197s" or "Please retry in 32s"
  const retryMatch = msg.match(/Please retry in ([\d.]+)s/i);
  if (retryMatch && retryMatch[1]) {
    const sec = parseFloat(retryMatch[1]);
    if (!isNaN(sec) && sec > 0) {
      return Math.ceil(sec * 1000);
    }
  }
  // Check retryDelay field if present (e.g. JSON in message: "retryDelay":"32s")
  const delayJsonMatch = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (delayJsonMatch && delayJsonMatch[1]) {
    const sec = parseInt(delayJsonMatch[1], 10);
    if (!isNaN(sec) && sec > 0) {
      return sec * 1000;
    }
  }
  // Check header retry-after in axios response
  const retryAfter = e.response?.headers?.["retry-after"];
  if (retryAfter) {
    const sec = parseInt(retryAfter, 10);
    if (!isNaN(sec) && sec > 0) {
      return sec * 1000;
    }
  }
  return null;
}

// ── Circuit Breaker ──

// Circuits are kept per candidate ("platform/model"), so one overloaded model does not lock out
// the healthy models of the same platform.

export interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

export const CIRCUIT_THRESHOLD = 3;
export const CIRCUIT_COOLDOWN_MS = 300_000; // 5 minutes

export const circuits: Record<string, CircuitState> = {};

export function getCircuit(provider: string): CircuitState {
  if (!circuits[provider]) {
    circuits[provider] = { failures: 0, lastFailure: 0, isOpen: false };
  }
  return circuits[provider]!;
}

export function recordFailure(provider: string, error?: unknown): void {
  // Distinguish rate limit errors from complete infrastructure outages
  if (error && isRateLimitError(error)) {
    console.warn(`  ℹ️ Rate limit on ${provider}. Not recording as infrastructure outage in circuit breaker.`);
    return;
  }

  const circuit = getCircuit(provider);
  circuit.failures++;
  circuit.lastFailure = Date.now();
  if (circuit.failures >= CIRCUIT_THRESHOLD) {
    circuit.isOpen = true;
    console.warn(`⚡ Circuit breaker OPEN for provider: ${provider} (${circuit.failures} consecutive outage failures)`);
  }
}

export function isCircuitOpen(provider: string): boolean {
  const circuit = getCircuit(provider);
  if (!circuit.isOpen) return false;
  // Check if cooldown period has passed
  if (Date.now() - circuit.lastFailure > CIRCUIT_COOLDOWN_MS) {
    circuit.isOpen = false;
    circuit.failures = 0;
    console.log(`⚡ Circuit breaker CLOSED for provider: ${provider} (cooldown expired)`);
    return false;
  }
  return true;
}

export function recordSuccess(provider: string): void {
  const circuit = getCircuit(provider);
  circuit.failures = 0;
  circuit.isOpen = false;
}

export function resetCircuits(): void {
  for (const key of Object.keys(circuits)) {
    delete circuits[key];
  }
}

// ── Provider Implementations ──

const GEMINI_TIMEOUT_MS = 180_000;

async function callGemini(request: LLMRequest, modelAlias: string): Promise<LLMResponse> {
  const modelName = await resolveModel(modelAlias, "google");

  const generationConfig: GenerateContentConfig = {
    systemInstruction: request.systemPrompt,
    // Without a timeout a stalled request hangs the run until the job times out.
    httpOptions: { timeout: GEMINI_TIMEOUT_MS },
  };
  // Item 1.1: Structured Output (the schemas use the OpenAPI subset, e.g. type "OBJECT")
  if (request.responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = request.responseSchema as Schema;
  }
  if (request.temperature !== undefined) {
    generationConfig.temperature = request.temperature;
  }
  if (request.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = request.maxOutputTokens;
  }

  const start = Date.now();
  const response = await geminiClient.models.generateContent({
    model: modelName,
    contents: request.userPrompt,
    config: generationConfig,
  });

  const latencyMs = Date.now() - start;
  const usage = response.usageMetadata;

  return {
    text: response.text ?? "",
    model: modelName,
    provider: "google",
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    latencyMs,
  };
}

// ── Structured Output for OpenAI and Anthropic ──

/** Name of the JSON schema (OpenAI) and of the forced tool (Anthropic) that carry structured output. */
const STRUCTURED_OUTPUT_NAME = "structured_output";

/**
 * Converts a response schema in Gemini's OpenAPI subset (upper-case types such as "OBJECT", see
 * prompts.ts) to JSON Schema: lower-case types, and `additionalProperties: false` on every object.
 */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") converted[key] = value.toLowerCase();
    else if (key === "properties" && typeof value === "object" && value !== null) {
      converted[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, toJsonSchema(sub)]));
    } else converted[key] = toJsonSchema(value);
  }
  if (converted["type"] === "object" && !("additionalProperties" in converted)) {
    converted["additionalProperties"] = false;
  }
  return converted;
}

/** OpenAI's strict mode needs every property of every object to be required. */
function requiresAllProperties(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(requiresAllProperties);
  if (typeof schema !== "object" || schema === null) return true;
  const { properties, required } = schema as { properties?: Record<string, unknown>; required?: unknown };
  if (properties) {
    const requiredNames = Array.isArray(required) ? required : [];
    if (!Object.keys(properties).every((name) => requiredNames.includes(name))) return false;
  }
  return Object.values(schema).every(requiresAllProperties);
}

async function callOpenAI(request: LLMRequest, model: string): Promise<LLMResponse> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
    temperature: request.temperature ?? 0.3,
  };

  if (request.responseSchema) {
    const schema = toJsonSchema(request.responseSchema);
    body["response_format"] = {
      type: "json_schema",
      json_schema: { name: STRUCTURED_OUTPUT_NAME, schema, strict: requiresAllProperties(schema) },
    };
  }

  const start = Date.now();
  const response = await axios.post("https://api.openai.com/v1/chat/completions", body, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    timeout: 60000,
  });

  const latencyMs = Date.now() - start;
  const choice = response.data?.choices?.[0];
  const usage = response.data?.usage;

  return {
    text: choice?.message?.content ?? "",
    model,
    provider: "openai",
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    latencyMs,
  };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

async function callAnthropic(request: LLMRequest, model: string): Promise<LLMResponse> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const body: Record<string, unknown> = {
    model,
    system: request.systemPrompt,
    messages: [{ role: "user", content: request.userPrompt }],
    max_tokens: request.maxOutputTokens ?? 4096,
    temperature: request.temperature ?? 0.3,
  };
  // Structured output: a single tool whose input schema is the response schema, and a forced
  // call to it. The tool call's input is the structured result.
  if (request.responseSchema) {
    body["tools"] = [
      {
        name: STRUCTURED_OUTPUT_NAME,
        description: "Return the result in this structure.",
        input_schema: toJsonSchema(request.responseSchema),
      },
    ];
    body["tool_choice"] = { type: "tool", name: STRUCTURED_OUTPUT_NAME };
  }

  const start = Date.now();
  const response = await axios.post("https://api.anthropic.com/v1/messages", body, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01", // the only version the Messages API accepts
      "Content-Type": "application/json",
    },
    timeout: 60000,
  });

  const latencyMs = Date.now() - start;
  const content: AnthropicContentBlock[] = response.data?.content ?? [];
  const toolCall = content.find((block) => block.type === "tool_use" && block.name === STRUCTURED_OUTPUT_NAME);
  const text = toolCall
    ? JSON.stringify(toolCall.input)
    : content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
  const usage = response.data?.usage;

  return {
    text,
    model,
    provider: "anthropic",
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    latencyMs,
  };
}

// ── Unified Gateway ──

interface ProviderConfig {
  platform: string;
  model: string;
}

function getProviderConfigs(phase: "map" | "reduce"): ProviderConfig[] {
  const primary = config.settings.models;
  const providers: ProviderConfig[] = [{ platform: primary.platform, model: primary[phase] }];

  // In-provider fallback: when this phase's Google model is rejected or unavailable, retry with
  // the other phase's model before moving to an external provider. For Reduce this covers Free
  // Tier keys whose Pro model hits "limit: 0"; for Map it covers a map model that cannot serve the
  // request at all (e.g. an auto-resolved model that rejects system instructions with a 400).
  const alternateModel = phase === "reduce" ? primary.map : primary.reduce;
  if (primary.platform === "google" && alternateModel !== primary[phase]) {
    providers.push({ platform: "google", model: alternateModel });
  }

  // Add fallback providers if configured
  const fallback = config.settings.fallback_models;
  if (fallback) {
    providers.push({ platform: fallback.platform, model: fallback[phase] });
  }

  return providers;
}

async function callProvider(provider: ProviderConfig, request: LLMRequest): Promise<LLMResponse> {
  switch (provider.platform) {
    case "google":
      return callGemini(request, provider.model);
    case "openai":
      return callOpenAI(request, provider.model);
    case "anthropic":
      return callAnthropic(request, provider.model);
    default:
      throw new Error(`Unknown platform: ${provider.platform}`);
  }
}

export async function callProviderWithRetry(provider: ProviderConfig, request: LLMRequest): Promise<LLMResponse> {
  return pRetry(
    async () => {
      try {
        return await callProvider(provider, request);
      } catch (error) {
        const status = asErrorLike(error).status ?? asErrorLike(error).response?.status;
        // Client errors (400 Bad Request, 401 Unauthorized, 403 Forbidden) should NOT retry
        if (status === 400 || status === 401 || status === 403) {
          throw new AbortError(toError(error));
        }
        // If quota limit is 0 (e.g. Pro model on Free Tier), retrying will never succeed.
        // Abort immediately so fallback provider/model can take over without wasting minutes.
        const msg = String(asErrorLike(error).message || "");
        if (isRateLimitError(error) && (msg.includes("limit: 0") || msg.includes('"limit":0'))) {
          console.warn(
            `  ⚠️ Quota limit is 0 for ${provider.platform}/${provider.model}. Aborting retries immediately to allow fallback.`,
          );
          throw new AbortError(toError(error));
        }
        if (!isTransientError(error)) {
          throw new AbortError(toError(error));
        }
        throw error;
      }
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 2000,
      maxTimeout: 65000,
      onFailedAttempt: async ({ error, attemptNumber, retriesLeft }) => {
        const isRateLimit = isRateLimitError(error);
        const errorType = isRateLimit ? "RateLimit (429)" : "TransientError (503/Timeout)";
        const delayHint = extractRetryDelayMs(error);
        console.warn(
          `  ⚠️ [${errorType}] ${provider.platform}/${provider.model} attempt ${attemptNumber} failed: ${errorMessage(error)}. (${retriesLeft} retries left)`,
        );
        if (delayHint && delayHint > 0 && retriesLeft > 0) {
          console.log(`  ⏳ Respecting upstream retry delay: waiting ${Math.ceil(delayHint / 1000)}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayHint));
        }
      },
    },
  );
}

/**
 * Core LLM call function with automatic fallback and metrics recording.
 * Tries the primary provider first, falls back to secondary on failure.
 */
export async function llmCall(request: LLMRequest): Promise<LLMResponse> {
  const phase = request.phase === "reduce" ? "reduce" : "map";
  const providers = getProviderConfigs(phase);
  if (request.model && providers[0]) {
    providers[0] = { ...providers[0], model: request.model };
  }
  let lastError: string | undefined;

  for (const provider of providers) {
    const circuitKey = `${provider.platform}/${provider.model}`;
    if (isCircuitOpen(circuitKey)) {
      console.warn(`  ⚡ Skipping ${circuitKey} (circuit open)`);
      continue;
    }

    try {
      const response = await callProviderWithRetry(provider, request);
      recordSuccess(circuitKey);

      // Record metrics (Item 4.1)
      const cost = estimateCost(response.model, response.inputTokens, response.outputTokens);
      metrics.recordLLMCall({
        phase: request.phase,
        model: response.model,
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
        latency_ms: response.latencyMs,
        estimated_cost_usd: cost,
      });

      return response;
    } catch (error) {
      const originalError = error instanceof AbortError ? error.originalError : error;
      // Only infrastructure failures (5xx, timeouts, network) count toward the circuit breaker.
      // Client errors such as a 400 from a model that cannot serve this request do not open it.
      if (isTransientError(originalError)) {
        recordFailure(circuitKey, originalError);
      }
      // Every failure is recorded and the next candidate is tried: a client error from one model
      // (e.g. "Developer instruction is not enabled for this model") says nothing about the others.
      lastError = `${provider.platform}/${provider.model}: ${errorMessage(originalError)}`;
      metrics.recordError(`[${request.phase}] ${lastError}`);
      console.warn(`  ⚠️ ${lastError}. Trying next provider...`);
    }
  }

  throw new Error(
    `All LLM providers failed for phase: ${request.phase} (last error: ${lastError ?? "every provider was skipped by its circuit breaker"})`,
  );
}
