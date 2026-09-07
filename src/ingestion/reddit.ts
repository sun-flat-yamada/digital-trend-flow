/**
 * [Role] Reddit ingestion module.
 * [Mechanism] Fetches hot/top posts from tech subreddits (e.g., r/LocalLLaMA, r/MachineLearning)
 * via public JSON endpoints and converts to normalized ArticleItem format.
 */

import axios from "axios";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

interface RedditPostData {
  id: string;
  title: string;
  url: string;
  permalink: string;
  score: number;
  created_utc: number;
  is_self: boolean;
  over_18?: boolean;
}

interface RedditApiResponse {
  data?: {
    children?: Array<{
      data: RedditPostData;
    }>;
  };
}

/**
 * Fetches top/hot posts from a subreddit above a minimum score threshold.
 *
 * @param subreddit Subreddit name (e.g. "LocalLLaMA", "MachineLearning")
 * @param minScore Minimum upvote score threshold (default: 50)
 * @param maxItems Maximum items to return (default: 15)
 * @param purpose Target purpose key
 */
export async function fetchReddit(
  subreddit: string,
  minScore: number = 50,
  maxItems: number = 15,
  purpose: string = "ai_dev_tools"
): Promise<ArticleItem[]> {
  const cleanSubreddit = subreddit.replace(/^r\//i, "");
  const endpoint = `https://www.reddit.com/r/${cleanSubreddit}/hot.json?limit=${Math.min(maxItems * 2, 50)}`;

  try {
    const response = await axios.get<RedditApiResponse>(endpoint, {
      headers: {
        "User-Agent": "digital-trend-flow:v2.0 (technology trend harvester)",
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const children = response.data?.data?.children ?? [];
    const articles: ArticleItem[] = [];

    for (const child of children) {
      const post = child.data;
      if (!post || !post.title) continue;
      if (post.over_18) continue; // Skip NSFW
      if (post.score < minScore) continue;

      // Determine target URL: use external link if present, otherwise reddit discussion permalink
      const targetUrl =
        post.url && !post.url.includes("reddit.com/r/") && !post.is_self
          ? post.url
          : `https://www.reddit.com${post.permalink}`;

      if (isProcessed(targetUrl)) continue;

      articles.push({
        sourceName: `Reddit r/${cleanSubreddit}`,
        sourceType: "reddit",
        purpose,
        title: `${post.title} (Reddit: ▲${post.score})`,
        url: targetUrl,
        publishedAt: new Date(post.created_utc * 1000).toISOString(),
      });

      if (articles.length >= maxItems) break;
    }

    console.log(`  🤖 Reddit [r/${cleanSubreddit}]: ${articles.length} posts (score ≥ ${minScore})`);
    return articles;
  } catch (error: any) {
    console.warn(`⚠️ Reddit fetch failed for r/${cleanSubreddit}: ${error.message}`);
    return [];
  }
}
