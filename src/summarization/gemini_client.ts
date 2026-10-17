/**
 * [Role] The shared Google Gen AI SDK client (`@google/genai`) for the Gemini Developer API.
 * [Mechanism] One client for generation (llm_gateway.ts) and model listing (model_resolver.ts).
 * Its own HTTP retries stay off (no `httpOptions.retryOptions`): the gateway decides what to retry
 * and when to move on to the next candidate model or provider.
 */

import { GoogleGenAI } from "@google/genai";
import { env } from "../core/config";

export const geminiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
