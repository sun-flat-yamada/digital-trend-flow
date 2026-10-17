/**
 * [Role] Routes a configured source to its ingestion adapter.
 * [Mechanism] Used by the daily pipeline and by `npm run check:sources`, so both fetch every
 * source type the same way. Adapters throw on failure; an empty array means "reachable, nothing new".
 */

import { config } from "../core/config";
import type { ArticleItem, Source } from "../core/types";
import { fetchRss } from "./rss";
import { fetchRaindropBookmarks, type RaindropFetchResult } from "./raindrop";
import { fetchXViGrok } from "./xai_grok";
import { fetchHackerNews } from "./hackernews";
import { fetchArxiv } from "./arxiv";
import { fetchYouTube } from "./youtube";
import { fetchGitHubTrending } from "./github_trending";
import { fetchReddit } from "./reddit";
import { fetchBluesky } from "./bluesky";

export type SourceWithPurpose = Source & { purpose: string };

/** Raindrop results also carry the IDs to archive after the run. */
export type RaindropResultSet = RaindropFetchResult & { collectionId: number; archiveId: number | undefined };

/** How far back a source fetches: its own `lookback_hours`, else `settings.freshness.max_age_hours`. */
const lookbackHoursFor = (s: { lookback_hours?: number | undefined }): number =>
  s.lookback_hours ?? config.settings.freshness.max_age_hours;

/** Fetches one source. `onRaindrop` receives a Raindrop source's full result (for archiving). */
export async function fetchSource(
  s: SourceWithPurpose,
  onRaindrop?: (result: RaindropResultSet) => void,
): Promise<ArticleItem[]> {
  switch (s.type) {
    case "rss":
      return fetchRss(s.name, s.url, s.purpose, lookbackHoursFor(s));
    case "raindrop": {
      const result = await fetchRaindropBookmarks(s.collection_id, s.name, s.lookback_hours, s.purpose);
      onRaindrop?.({ ...result, collectionId: s.collection_id, archiveId: s.archive_collection_id });
      return result.articles;
    }
    case "xai_grok":
      return fetchXViGrok(s.query, s.name, s.purpose);
    case "hackernews":
      return fetchHackerNews(s.name, s.min_score, s.max_items, s.purpose);
    case "arxiv":
      return fetchArxiv(s.query, s.name, s.max_results, s.purpose);
    case "youtube":
      return fetchYouTube(s.name, s.query, s.channel_id, s.max_results, s.purpose, lookbackHoursFor(s));
    case "github_trending":
      return fetchGitHubTrending(s.name, s.language_filter, s.since, s.purpose);
    case "reddit":
      return fetchReddit(s.subreddit, s.min_score, s.max_items, s.purpose);
    case "bluesky":
      return fetchBluesky(s.query, s.min_likes, s.max_items, s.purpose);
  }
}
