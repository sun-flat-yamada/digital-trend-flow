import axios from "axios";
import { env } from "../core/config";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const XAI_API_BASE = "https://api.x.ai/v1";

/**
 * ======================================================================
 * X (Twitter) Ingestion Module via xAI Grok API
 * ======================================================================
 *
 * ## Strategy
 *   Uses xAI's native `x_search` tool through the `/v1/responses` endpoint.
 *   Grok has privileged, real-time access to the X (Twitter) corpus, making
 *   it the most reliable and official way to search X content programmatically
 *   as of 2026 (the old Twitter API v2 requires expensive Enterprise tier).
 *
 * ## How it works
 *   1. Send a chat completion request to the `/v1/responses` endpoint with
 *      a system prompt instructing Grok to search X and return structured JSON.
 *   2. Grok internally uses its `x_search` tool to query the X corpus.
 *   3. The response contains a structured list of trending posts with URLs.
 *
 * ## Authentication
 *   Bearer token via `XAI_API_KEY` environment variable.
 *   Generate at: https://console.x.ai/
 *
 * ## Deduplication
 *   Each X post URL (e.g., https://x.com/user/status/123) is checked against
 *   the state_manager to skip previously processed posts.
 *
 * ## Rate Limits
 *   xAI API allows generous rate limits for standard tier.
 *   We make exactly 1 request per query per pipeline run.
 * ======================================================================
 */

interface XSearchResult {
  title: string;
  url: string;
  snippet: string;
  published_at: string;
}

const SYSTEM_PROMPT = `You are a research assistant that searches X (Twitter) for trending posts.
Given a search query, use your x_search capability to find the most relevant and popular recent posts.

Return ONLY valid JSON (no markdown fences) in this exact format:
{
  "results": [
    {
      "title": "Brief description of the post content (max 100 chars)",
      "url": "https://x.com/username/status/1234567890",
      "snippet": "Key quote or summary from the post (max 200 chars)",
      "published_at": "ISO 8601 timestamp"
    }
  ]
}

Rules:
- Return between 5 and 20 results, prioritizing posts with high engagement.
- Only include posts from the last 24 hours.
- Each URL must be a direct link to the specific post.
- Focus on substantive content, not replies or retweets without commentary.`;

/**
 * Searches X (Twitter) via the xAI Grok API's x_search tool and returns
 * structured results as ArticleItems.
 *
 * @param query  The search query (e.g., "AI OR LLM min_faves:100")
 * @param sourceName  Human-readable name for logging
 * @returns Array of new (unprocessed) ArticleItems from X
 */
export async function fetchXViGrok(
  query: string,
  sourceName: string = "X via Grok",
  purpose: string = "ai_dev_tools"
): Promise<ArticleItem[]> {
  const apiKey = env.XAI_API_KEY;

  if (!apiKey) {
    console.log("ℹ️ X/Grok ingestion skipped (XAI_API_KEY not set).");
    return [];
  }

  try {
    const response = await axios.post(
      `${XAI_API_BASE}/chat/completions`,
      {
        model: "grok-3-fast",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Search X for the following query and return trending posts from the last 24 hours:\n\n${query}`,
          },
        ],
        temperature: 0.1, // Low temperature for factual output
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30s timeout — Grok x_search can be slow
      }
    );

    const rawContent = response.data?.choices?.[0]?.message?.content ?? "";

    // Parse the JSON response from Grok
    const cleanedJson = rawContent
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let parsed: { results: XSearchResult[] };
    try {
      parsed = JSON.parse(cleanedJson);
    } catch (parseErr) {
      console.warn(`⚠️ Failed to parse Grok x_search JSON response for "${sourceName}".`);
      return [];
    }

    const newItems: ArticleItem[] = [];

    for (const result of parsed.results) {
      if (!result.url) continue;

      // Validate URL format: must be a genuine X.com / Twitter post URL
      if (!/^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/.test(result.url)) {
        console.warn(`  ⚠️ Skipping invalid X post URL: ${result.url}`);
        continue;
      }

      // Deduplication via state manager
      if (isProcessed(result.url)) {
        continue;
      }

      newItems.push({
        sourceName,
        sourceType: "xai_grok",
        purpose,
        title: result.title || result.snippet || "X Post",
        url: result.url,
        publishedAt: result.published_at || new Date().toISOString(),
      });
    }

    console.log(`  🐦 X/Grok [${sourceName}]: ${newItems.length} new posts (${parsed.results.length} total found).`);
    return newItems;
  } catch (error: any) {
    // Non-fatal: pipeline continues even if X search fails
    console.error(`⚠️ X/Grok search failed for "${sourceName}": ${error.message}`);
    return [];
  }
}
