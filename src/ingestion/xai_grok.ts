import axios from "axios";
import { env } from "../core/config";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const XAI_API_BASE = "https://api.x.ai/v1";

/**
 * ======================================================================
 * X (Twitter) Ingestion Module via xAI Grok API — currently DISABLED
 * ======================================================================
 *
 * ## Current implementation
 *   Sends a plain chat completion request (`/v1/chat/completions`, model
 *   `grok-3-fast`) asking Grok to list trending posts as JSON. No search tool
 *   is attached, so the model answers from its own knowledge and can return
 *   post URLs that do not exist; only the URL format is checked.
 *
 * ## Why it is disabled
 *   Until the request uses xAI's server-side `x_search` tool (`/v1/responses`)
 *   and the returned citations, the results cannot be trusted as sources.
 *   `XAI_GROK_DISABLED_REASON` makes the pipeline skip every `xai_grok`
 *   source and record it as "disabled" (improvement plan ING-4).
 *
 * ## Authentication
 *   Bearer token via `XAI_API_KEY` environment variable.
 *
 * ## Deduplication
 *   Each X post URL is checked against the state_manager to skip previously
 *   processed posts.
 * ======================================================================
 */

/** Non-null while the module must not be used; see the header comment. */
export const XAI_GROK_DISABLED_REASON: string | null =
  "X/Grok ingestion is disabled until it uses the x_search tool (generated post URLs cannot be verified)";

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
      throw new Error(`Failed to parse Grok JSON response for "${sourceName}"`, { cause: parseErr });
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
    // Propagate, so the run records the source as failing rather than empty.
    throw new Error(`X/Grok search failed for "${sourceName}": ${error.message}`, { cause: error });
  }
}
