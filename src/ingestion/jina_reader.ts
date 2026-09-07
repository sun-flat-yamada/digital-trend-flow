/**
 * [Role] Abstracted content extraction with provider fallback.
 * [Mechanism] Wraps Jina Reader and Firecrawl behind a unified interface
 * to enable automatic fallback on extraction failure.
 *
 * Item: 2.1 Content Extractor Abstraction + Firecrawl Fallback
 */

import axios from "axios";
import pRetry from "p-retry";
import { env } from "../core/config";

const JINA_API_BASE = "https://r.jina.ai/";
const FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v1";

/**
 * Extracts clean Markdown content from a URL.
 * Tries Firecrawl first (if API key is set), falls back to Jina Reader.
 */
export async function extractMarkdown(url: string): Promise<string> {
  // Try Firecrawl first if configured
  if (env.FIRECRAWL_API_KEY) {
    try {
      return await extractViaFirecrawl(url);
    } catch (error: any) {
      console.warn(`  ⚠️ Firecrawl failed for ${url}: ${error.message}. Falling back to Jina...`);
    }
  }

  // Fallback to Jina Reader
  return extractViaJina(url);
}

/**
 * Extracts content via Firecrawl API (managed, JS-rendered).
 */
async function extractViaFirecrawl(url: string): Promise<string> {
  const response = await axios.post(
    `${FIRECRAWL_API_BASE}/scrape`,
    {
      url,
      formats: ["markdown"],
    },
    {
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const markdown = response.data?.data?.markdown;
  if (!markdown) {
    throw new Error("Firecrawl returned empty markdown");
  }
  return markdown;
}

/**
 * Extracts content via Jina Reader API (original implementation).
 */
async function extractViaJina(url: string): Promise<string> {
  const fetchContent = async () => {
    const targetUrl = `${JINA_API_BASE}${url}`;
    const response = await axios.get(targetUrl, {
      headers: { Accept: "text/plain" },
      timeout: 10000,
    });

    if (response.status !== 200) {
      throw new Error(`Jina API returned status ${response.status}`);
    }

    return response.data as string;
  };

  try {
    return await pRetry(fetchContent, {
      retries: 3,
      onFailedAttempt: (error) => {
        console.warn(
          `⚠️ Jina extraction attempt ${error.attemptNumber} failed for ${url}. ${error.retriesLeft} retries left.`
        );
      },
    });
  } catch (error: any) {
    console.error(`❌ Failed to extract markdown for ${url} after all retries: ${error.message}`);
    return "";
  }
}

// Legacy re-export for backward compatibility
export { extractMarkdown as extractMarkdownViaJina };
