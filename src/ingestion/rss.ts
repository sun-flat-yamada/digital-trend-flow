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
}

const parser = new Parser();

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
    console.error(`⚠️ Failed to fetch RSS feed [${sourceName}]: ${error.message}`);
    return [];
  }
}
