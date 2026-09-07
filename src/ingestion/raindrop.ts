import axios from "axios";
import { env } from "../core/config";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const RAINDROP_API_BASE = "https://api.raindrop.io/rest/v1";
const MAX_PER_PAGE = 50; // API maximum
const MAX_PAGES = 5;     // Safety cap: 50 * 5 = 250 items max per run

/**
 * ======================================================================
 * Raindrop.io Ingestion Module — Best Practices Implementation
 * ======================================================================
 *
 * ## Deduplication Strategy (3-Layer Protection)
 *
 *   Layer 1 (API Level):  Sort by `-created` (newest first) and only fetch
 *                         items created within the last 48 hours via client-
 *                         side date filtering. This prevents re-scanning the
 *                         entire Raindrop library on every run.
 *
 *   Layer 2 (State DB):   Each URL is checked against `processed_urls.json`
 *                         via `isProcessed()`. Items already successfully
 *                         processed in a previous pipeline run are skipped.
 *
 *   Layer 3 (Archive):    After the main pipeline completes successfully,
 *                         `archiveProcessedRaindrops()` moves processed items
 *                         from the Inbox (-1) to a dedicated "Processed" 
 *                         collection. This ensures they won't appear in the
 *                         Inbox on the next run, even if the state DB is lost.
 *
 * ## Pagination
 *   The API returns max 50 items per page (0-indexed). We paginate until
 *   we receive fewer items than `perpage` or hit MAX_PAGES.
 *
 * ## Rate Limiting
 *   Raindrop.io allows 120 requests/minute. With MAX_PAGES=5, we use at
 *   most ~6 requests per collection (5 GETs + 1 PUT for archiving).
 *
 * ## Config
 *   - `RAINDROP_TEST_TOKEN`: Bearer token from App Management Console.
 *   - `collection_id`: -1 (Unsorted/Inbox) recommended for Clipper workflow.
 *   - Optional: Specify a numeric `archive_collection_id` in config for
 *     the "Processed" collection. Defaults to not archiving if unset.
 * ======================================================================
 */

interface RaindropItem {
  _id: number;
  title: string;
  link: string;
  created: string; // ISO 8601
  tags: string[];
}

/**
 * Fetches new (unprocessed) bookmarks from a Raindrop.io collection,
 * with pagination and date-based filtering.
 *
 * @param collectionId  Raindrop collection ID (-1 = Unsorted/Inbox, 0 = All)
 * @param collectionName  Human-readable name for logging
 * @param lookbackHours  Only consider items created within this window (default: 48h)
 * @returns Array of new ArticleItems and their Raindrop IDs (for later archiving)
 */
export async function fetchRaindropBookmarks(
  collectionId: number = -1,
  collectionName: string = "Inbox",
  lookbackHours: number = 48,
  purpose: string = "curated"
): Promise<{ articles: ArticleItem[]; raindropIds: number[] }> {
  const token = env.RAINDROP_TEST_TOKEN;

  if (!token) {
    console.log("ℹ️ Raindrop ingestion skipped (RAINDROP_TEST_TOKEN not set).");
    return { articles: [], raindropIds: [] };
  }

  const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const newArticles: ArticleItem[] = [];
  const processedRaindropIds: number[] = [];

  try {
    let page = 0;
    let hasMore = true;

    while (hasMore && page < MAX_PAGES) {
      const response = await axios.get(
        `${RAINDROP_API_BASE}/raindrops/${collectionId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            perpage: MAX_PER_PAGE,
            page,
            sort: "-created", // Newest first — critical for date-based early exit
          },
          timeout: 10000,
        }
      );

      const items: RaindropItem[] = response.data?.items ?? [];

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of items) {
        // --- Layer 1: Date filtering ---
        // Since items are sorted by -created, once we hit an item older than
        // the cutoff, ALL subsequent items will also be older. Stop early.
        const createdAt = new Date(item.created);
        if (createdAt < cutoffDate) {
          hasMore = false;
          break;
        }

        if (!item.link) continue;

        // --- Layer 2: State DB deduplication ---
        if (isProcessed(item.link)) {
          // Already processed in a previous run. Track its ID for archiving
          // but don't add it to the article list.
          processedRaindropIds.push(item._id);
          continue;
        }

        newArticles.push({
          sourceName: `Raindrop: ${collectionName}`,
          sourceType: "raindrop",
          purpose,
          title: item.title || "Untitled",
          url: item.link,
          publishedAt: item.created || new Date().toISOString(),
        });

        // Track ID so we can archive it after successful processing
        processedRaindropIds.push(item._id);
      }

      // If we received fewer than MAX_PER_PAGE, we've reached the last page
      if (items.length < MAX_PER_PAGE) {
        hasMore = false;
      }

      page++;
    }

    console.log(
      `  📎 Raindrop [${collectionName}]: ${newArticles.length} new items ` +
      `(scanned ${page} page(s), cutoff: ${lookbackHours}h)`
    );

    return { articles: newArticles, raindropIds: processedRaindropIds };
  } catch (error: any) {
    console.error(`⚠️ Failed to fetch Raindrop bookmarks for "${collectionName}": ${error.message}`);
    return { articles: [], raindropIds: [] };
  }
}

/**
 * --- Layer 3: Archive Workflow ---
 *
 * Moves successfully processed Raindrop items from their source collection
 * to a designated "Processed" archive collection. This provides a physical
 * separation that prevents re-processing even if the state DB is reset.
 *
 * Uses the Raindrop.io bulk update endpoint:
 *   PUT /rest/v1/raindrops/{sourceCollectionId}
 *   Body: { ids: [...], collection: { "$id": archiveCollectionId } }
 *
 * @param sourceCollectionId  The collection items were fetched from (e.g., -1)
 * @param raindropIds  Array of Raindrop item IDs to move
 * @param archiveCollectionId  Target collection ID for processed items.
 *                             Create this collection manually in Raindrop.io
 *                             (e.g., name it "HQ Processed").
 */
export async function archiveProcessedRaindrops(
  sourceCollectionId: number,
  raindropIds: number[],
  archiveCollectionId?: number
): Promise<void> {
  const token = env.RAINDROP_TEST_TOKEN;

  if (!token || !archiveCollectionId || raindropIds.length === 0) {
    return;
  }

  try {
    await axios.put(
      `${RAINDROP_API_BASE}/raindrops/${sourceCollectionId}`,
      {
        ids: raindropIds,
        collection: { "$id": archiveCollectionId },
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      }
    );

    console.log(
      `  📦 Raindrop: Archived ${raindropIds.length} items → collection #${archiveCollectionId}`
    );
  } catch (error: any) {
    // Non-fatal: don't crash the pipeline for an archive failure.
    // Items will simply be picked up again but skipped by Layer 2 (state DB).
    console.warn(`⚠️ Raindrop archive failed: ${error.message}`);
  }
}
