/**
 * [Role] Abstracted content extraction with provider fallback.
 * [Mechanism] Wraps Jina Reader and Firecrawl behind a unified interface
 * to enable automatic fallback on extraction failure. Only transient failures
 * (network errors, timeouts, 408/429/5xx) are retried, and a host that fails
 * twice in a row is skipped for the rest of the run. Failures throw, so the
 * caller can fall back to the source's own description.
 *
 * Item: 2.1 Content Extractor Abstraction + Firecrawl Fallback
 */

import axios from "axios";
import pRetry, { AbortError } from "../core/retry";
import { env } from "../core/config";

const JINA_API_BASE = "https://r.jina.ai/";
const FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v1";

/** Consecutive failures after which the remaining URLs on the same host are not requested. */
const HOST_FAILURE_LIMIT = 2;
const hostFailures = new Map<string, number>();

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** True for failures worth retrying: no response at all, a timeout, rate limiting or a server error. */
export function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

/** Clears the per-host failure counts (between runs, and in tests). */
export function resetExtractionState(): void {
  hostFailures.clear();
}

/**
 * Extracts clean Markdown content from a URL.
 * Tries Firecrawl first (if API key is set), falls back to Jina Reader.
 * Throws when no content could be extracted; the error message gives the reason.
 */
export async function extractMarkdown(url: string): Promise<string> {
  const host = hostOf(url);
  const failures = hostFailures.get(host) ?? 0;
  if (failures >= HOST_FAILURE_LIMIT) {
    throw new Error(`skipped: ${failures} consecutive extraction failures on ${host}`);
  }
  try {
    const markdown = await extractWithFallback(url);
    hostFailures.delete(host);
    return markdown;
  } catch (error) {
    // Read the count again: extractions run concurrently, and other requests to this host may
    // have failed while this one was in flight.
    hostFailures.set(host, (hostFailures.get(host) ?? 0) + 1);
    throw error;
  }
}

async function extractWithFallback(url: string): Promise<string> {
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
    try {
      const response = await axios.get(targetUrl, {
        headers: {
          Accept: "text/plain",
          // An API key raises the rate limit; anonymous requests are throttled per IP.
          ...(env.JINA_API_KEY ? { Authorization: `Bearer ${env.JINA_API_KEY}` } : {}),
        },
        timeout: 20000,
      });
      const content = typeof response.data === "string" ? response.data.trim() : "";
      if (!content) {
        throw new AbortError("Jina returned empty content");
      }
      return content;
    } catch (error: any) {
      if (error instanceof AbortError) throw error;
      const status: number | undefined = error.response?.status;
      const reason = status !== undefined ? `Jina returned HTTP ${status}` : `Jina request failed: ${error.message}`;
      // A client error (blocked, not found, paywalled) will not change on retry.
      if (!isRetryableStatus(status)) throw new AbortError(reason);
      throw new Error(reason);
    }
  };

  return pRetry(fetchContent, {
    retries: 2,
    onFailedAttempt: (context) => {
      console.warn(
        `⚠️ Jina extraction attempt ${context.attemptNumber} failed for ${url} (${context.error.message}). ${context.retriesLeft} retries left.`
      );
    },
  });
}

// Legacy re-export for backward compatibility
export { extractMarkdown as extractMarkdownViaJina };
