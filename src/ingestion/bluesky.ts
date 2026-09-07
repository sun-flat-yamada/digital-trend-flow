/**
 * [Role] Bluesky AT Protocol public ingestion module.
 * [Mechanism] Uses Bluesky's public AppView API (public.api.bsky.app) to search
 * high-engagement tech posts without requiring private user credentials.
 */

import axios from "axios";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const BSKY_PUBLIC_API = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts";

interface BskyPostRecord {
  text?: string;
  createdAt?: string;
}

interface BskyEmbedExternal {
  external?: {
    uri?: string;
    title?: string;
    description?: string;
  };
}

interface BskyPostItem {
  uri: string;
  author: {
    handle: string;
    displayName?: string;
  };
  record?: BskyPostRecord;
  embed?: BskyEmbedExternal;
  likeCount?: number;
  repostCount?: number;
}

interface BskySearchResponse {
  posts?: BskyPostItem[];
}

/**
 * Fetches top posts from Bluesky matching a search query.
 *
 * @param query Search query (e.g. "LLM OR 'AI Agent'")
 * @param minLikes Minimum like count threshold (default: 20)
 * @param maxItems Maximum items to return (default: 15)
 * @param purpose Target purpose key
 */
export async function fetchBluesky(
  query: string,
  minLikes: number = 20,
  maxItems: number = 15,
  purpose: string = "ai_research"
): Promise<ArticleItem[]> {
  try {
    const response = await axios.get<BskySearchResponse>(BSKY_PUBLIC_API, {
      params: {
        q: query,
        limit: Math.min(maxItems * 2, 50),
        sort: "top",
      },
      headers: {
        Accept: "application/json",
        "User-Agent": "digital-trend-flow:v2.0 (bsky harvester)",
      },
      timeout: 10000,
    });

    const posts = response.data?.posts ?? [];
    const articles: ArticleItem[] = [];

    for (const post of posts) {
      const likes = post.likeCount ?? 0;
      if (likes < minLikes) continue;

      const rkey = post.uri.split("/").pop() ?? "";
      const bskyPostUrl = `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;

      // If post links to an external article, prefer the external URL
      const externalUri = post.embed?.external?.uri;
      const targetUrl = externalUri && !externalUri.includes("bsky.app")
        ? externalUri
        : bskyPostUrl;

      if (isProcessed(targetUrl)) continue;

      const postText = post.record?.text?.replace(/\n+/g, " ").trim() ?? "";
      const externalTitle = post.embed?.external?.title?.trim();

      const rawTitle = externalTitle || postText.slice(0, 100);
      if (!rawTitle) continue;

      const title = `${rawTitle} (Bluesky: ♥${likes})`;
      const publishedAt = post.record?.createdAt ?? new Date().toISOString();

      articles.push({
        sourceName: `Bluesky (${post.author.handle})`,
        sourceType: "bluesky",
        purpose,
        title,
        url: targetUrl,
        publishedAt,
      });

      if (articles.length >= maxItems) break;
    }

    console.log(`  🦋 Bluesky [${query}]: ${articles.length} posts (likes ≥ ${minLikes})`);
    return articles;
  } catch (error: any) {
    console.warn(`⚠️ Bluesky fetch failed for query "${query}": ${error.message}`);
    return [];
  }
}
