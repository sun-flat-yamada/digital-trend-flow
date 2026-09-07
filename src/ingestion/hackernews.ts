/**
 * [Role] Hacker News ingestion module.
 * [Mechanism] Uses the official HN API to fetch top/new stories and filters
 * by minimum score.
 *
 * Item: 2.3 New Source Types (Hacker News)
 */

import axios from "axios";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";

interface HNItem {
  id: number;
  title: string;
  url?: string;
  score: number;
  time: number;
  type: string;
}

/**
 * Fetches top Hacker News stories above a minimum score threshold.
 */
export async function fetchHackerNews(
  sourceName: string = "Hacker News",
  minScore: number = 100,
  maxItems: number = 30,
  purpose: string = "ai_dev_tools"
): Promise<ArticleItem[]> {
  try {
    // Get top story IDs
    const topResponse = await axios.get<number[]>(
      `${HN_API_BASE}/topstories.json`,
      { timeout: 10000 }
    );
    const topIds = topResponse.data.slice(0, maxItems * 2); // Fetch extras for filtering

    // Fetch story details in parallel (batched)
    const newItems: ArticleItem[] = [];
    const batchSize = 10;

    for (let i = 0; i < topIds.length && newItems.length < maxItems; i += batchSize) {
      const batch = topIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((id) =>
          axios.get<HNItem>(`${HN_API_BASE}/item/${id}.json`, { timeout: 5000 })
        )
      );

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const item = result.value.data;

        if (!item.url || !item.title) continue;
        if (item.score < minScore) continue;
        if (item.type !== "story") continue;
        if (isProcessed(item.url)) continue;

        newItems.push({
          sourceName,
          sourceType: "hackernews",
          purpose,
          title: `${item.title} (HN: ${item.score}pts)`,
          url: item.url,
          publishedAt: new Date(item.time * 1000).toISOString(),
        });

        if (newItems.length >= maxItems) break;
      }
    }

    console.log(`  📰 HN [${sourceName}]: ${newItems.length} stories (score ≥ ${minScore})`);
    return newItems;
  } catch (error: any) {
    console.error(`⚠️ Hacker News fetch failed: ${error.message}`);
    return [];
  }
}
