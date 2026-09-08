/**
 * [Role] Multi-provider LLM gateway with automatic fallback.
 * [Mechanism] Wraps Google Gemini, OpenAI, and Anthropic APIs behind a
 * unified interface. Implements circuit breaker pattern for resilience.
 *
 * Items: 1.1 Structured Output, 1.2 Multi-LLM Fallback, 1.4 Thinking Model
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import pRetry, { AbortError } from "../core/retry";
import { env, config } from "../core/config";
import { metrics, estimateCost } from "../core/metrics";
import type { LLMCallMetrics } from "../core/metrics";
import { resolveModel } from "./model_resolver";

// ── Types ──

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  phase: LLMCallMetrics["phase"];
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

export function isRateLimitError(error: any): boolean {
  const status = error?.status ?? error?.response?.status ?? error?.statusCode;
  if (status === 429) return true;
  const msg = String(error?.message || "");
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

export function isTransientError(error: any): boolean {
  if (isRateLimitError(error)) return true;
  const status = error?.status ?? error?.response?.status ?? error?.statusCode;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(error?.message || "");
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

export function extractRetryDelayMs(error: any): number | null {
  const msg = String(error?.message || "");
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
  const retryAfter = error?.response?.headers?.["retry-after"];
  if (retryAfter) {
    const sec = parseInt(retryAfter, 10);
    if (!isNaN(sec) && sec > 0) {
      return sec * 1000;
    }
  }
  return null;
}

// ── Circuit Breaker ──

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

export function recordFailure(provider: string, error?: any): void {
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

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

async function callGemini(request: LLMRequest, modelAlias: string): Promise<LLMResponse> {
  const modelName = await resolveModel(modelAlias, "google");
  const model = genAI.getGenerativeModel({ model: modelName });

  // Item 1.1: Build generation config with optional Structured Output
  const generationConfig: Record<string, unknown> = {};
  if (request.responseSchema) {
    generationConfig["responseMimeType"] = "application/json";
    generationConfig["responseSchema"] = request.responseSchema;
  }
  if (request.temperature !== undefined) {
    generationConfig["temperature"] = request.temperature;
  }
  if (request.maxOutputTokens !== undefined) {
    generationConfig["maxOutputTokens"] = request.maxOutputTokens;
  }

  const start = Date.now();
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: request.userPrompt }] }],
    systemInstruction: { role: "model", parts: [{ text: request.systemPrompt }] },
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  });

  const latencyMs = Date.now() - start;
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;

  return {
    text,
    model: modelName,
    provider: "google",
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    latencyMs,
  };
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
    body["response_format"] = {
      type: "json_schema",
      json_schema: {
        name: "extraction",
        schema: request.responseSchema,
        strict: true,
      },
    };
  }

  const start = Date.now();
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    body,
    {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: 60000,
    }
  );

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

async function callAnthropic(request: LLMRequest, model: string): Promise<LLMResponse> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const start = Date.now();
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      max_tokens: request.maxOutputTokens ?? 4096,
      temperature: request.temperature ?? 0.3,
    },
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2024-10-22",
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const latencyMs = Date.now() - start;
  const text = response.data?.content?.[0]?.text ?? "";
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
  const providers: ProviderConfig[] = [
    { platform: primary.platform, model: primary[phase] },
  ];

  // Add fallback providers if configured
  const fallback = config.settings.fallback_models;
  if (fallback) {
    providers.push({ platform: fallback.platform, model: fallback[phase] });
  }

  return providers;
}

async function callProvider(
  provider: ProviderConfig,
  request: LLMRequest
): Promise<LLMResponse> {
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

export async function callProviderWithRetry(
  provider: ProviderConfig,
  request: LLMRequest
): Promise<LLMResponse> {
  return pRetry(
    async () => {
      try {
        return await callProvider(provider, request);
      } catch (error: any) {
        const status = error?.status ?? error?.response?.status;
        // Client errors (400 Bad Request, 401 Unauthorized, 403 Forbidden) should NOT retry
        if (status === 400 || status === 401 || status === 403) {
          throw new AbortError(error);
        }
        if (!isTransientError(error)) {
          throw new AbortError(error);
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
          `  ⚠️ [${errorType}] ${provider.platform}/${provider.model} attempt ${attemptNumber} failed: ${error.message}. (${retriesLeft} retries left)`
        );
        if (delayHint && delayHint > 0 && retriesLeft > 0) {
          console.log(`  ⏳ Respecting upstream retry delay: waiting ${Math.ceil(delayHint / 1000)}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayHint));
        }
      },
    }
  );
}

/**
 * Core LLM call function with automatic fallback and metrics recording.
 * Tries the primary provider first, falls back to secondary on failure.
 */
export async function llmCall(request: LLMRequest): Promise<LLMResponse> {
  const phase = request.phase === "judge" || request.phase === "keyword_expansion"
    || request.phase === "trend_detection"
    ? "map" : request.phase;
  const providers = getProviderConfigs(phase as "map" | "reduce");

  for (const provider of providers) {
    if (isCircuitOpen(provider.platform)) {
      console.warn(`  ⚡ Skipping ${provider.platform} (circuit open)`);
      continue;
    }

    try {
      const response = await callProviderWithRetry(provider, request);
      recordSuccess(provider.platform);

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
    } catch (error: any) {
      const originalError = error instanceof AbortError ? error.originalError : error;
      const status = (originalError as any)?.status ?? (originalError as any)?.response?.status;
      // Only fallback on transient errors (rate limit, server error, timeout)
      if (status === 400 || status === 401 || status === 403) {
        // Client errors — don't fallback, re-throw
        throw originalError;
      }
      recordFailure(provider.platform, originalError);
      console.warn(
        `  ⚠️ ${provider.platform}/${provider.model} failed after retries: ${(originalError as any)?.message ?? originalError}. Trying next provider...`
      );
      metrics.recordError(`${provider.platform}/${provider.model}: ${(originalError as any)?.message ?? originalError}`);
    }
  }

  throw new Error(`All LLM providers failed for phase: ${request.phase}`);
}
