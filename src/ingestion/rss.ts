/**
 * [Role] Handles the ingestion of raw data from RSS feeds.
 * [Mechanism] Uses 'rss-parser' to fetch and parse XML feeds, then standardizes the output to 'ArticleItem' format.
 */

import Parser from "rss-parser";
import { isProcessed } from "./state_manager";

export interface ArticleItem {
  sourceName: string;
  sourceType: string;
  purpose: string; // Links to a key in config.purposes
  title: string;
  url: string;
  publishedAt: string;
  language?: string; // Item 2.6: Multi-language ingestion
  description?: string; // Plain-text summary from the source; used when content extraction fails
}

// Some publishers reject requests without a browser-like User-Agent (HTTP 403).
const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; DigitalTrendFlow/1.0; +https://github.com/sun-flat-yamada/digital-trend-flow)",
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
  },
});

/**
 * [Role] Fetches an RSS feed and filters for new, unprocessed items.
 * [Mechanism] Parses the URL via 'rss-parser', iterates through items, checks the 'state_manager' for deduplication, and maps to the internal 'ArticleItem' schema.
 */
export async function fetchRss(
  sourceName: string,
  url: string,
  purpose: string
): Promise<ArticleItem[]> {
  try {
    const feed = await parser.parseURL(url);
    const newItems: ArticleItem[] = [];

    const RSS_LOOKBACK_HOURS = 72;
    const cutoffDate = new Date(Date.now() - RSS_LOOKBACK_HOURS * 60 * 60 * 1000);

    for (const item of feed.items) {
      if (!item.title || !item.link) continue;

      // Date filtering: skip articles older than lookback window
      const publishedAt = item.isoDate || item.pubDate;
      if (publishedAt) {
        const pubDate = new Date(publishedAt);
        if (pubDate < cutoffDate) {
          continue;
        }
      }

      if (isProcessed(item.link)) {
        continue;
      }

      newItems.push({
        sourceName,
        sourceType: "rss",
        purpose,
        title: item.title,
        url: item.link,
        publishedAt: publishedAt || new Date().toISOString(),
      });
    }

    return newItems;
  } catch (error: any) {
    // Propagate, so the run records the source as failing rather than empty.
    throw new Error(`Failed to fetch RSS feed [${sourceName}]: ${error.message}`, { cause: error });
  }
}
