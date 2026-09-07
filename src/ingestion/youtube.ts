/**
 * [Role] YouTube video ingestion module.
 * [Mechanism] Uses the YouTube Data API v3 to search for recent videos
 * by query or channel, returning video metadata as ArticleItems.
 *
 * Item: 2.3 New Source Types (YouTube)
 */

import axios from "axios";
import { env } from "../core/config";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

interface YouTubeSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    publishedAt: string;
    channelTitle: string;
    description: string;
  };
}

/**
 * Fetches recent YouTube videos matching a query or from a channel.
 */
export async function fetchYouTube(
  sourceName: string = "YouTube",
  query?: string,
  channelId?: string,
  maxResults: number = 10,
  purpose: string = "ai_research"
): Promise<ArticleItem[]> {
  const apiKey = env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.log("ℹ️ YouTube ingestion skipped (YOUTUBE_API_KEY not set).");
    return [];
  }

  try {
    const params: Record<string, string | number> = {
      part: "snippet",
      type: "video",
      maxResults,
      order: "date",
      key: apiKey,
      publishedAfter: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    };

    if (query) params["q"] = query;
    if (channelId) params["channelId"] = channelId;

    const response = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      params,
      timeout: 10000,
    });

    const items: YouTubeSearchItem[] = response.data?.items ?? [];
    const newItems: ArticleItem[] = [];

    for (const item of items) {
      const videoUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;
      if (isProcessed(videoUrl)) continue;

      newItems.push({
        sourceName,
        sourceType: "youtube",
        purpose,
        title: `🎬 ${item.snippet.title} — ${item.snippet.channelTitle}`,
        url: videoUrl,
        publishedAt: item.snippet.publishedAt,
      });
    }

    console.log(`  📹 YouTube [${sourceName}]: ${newItems.length} new videos`);
    return newItems;
  } catch (error: any) {
    console.error(`⚠️ YouTube fetch failed: ${error.message}`);
    return [];
  }
}
