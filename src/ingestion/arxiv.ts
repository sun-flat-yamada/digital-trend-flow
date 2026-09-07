/**
 * [Role] arXiv paper ingestion module.
 * [Mechanism] Uses the arXiv API to search for recent papers and extract
 * title, abstract, and URL.
 *
 * Item: 2.3 New Source Types (arXiv)
 */

import axios from "axios";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const ARXIV_API_BASE = "https://export.arxiv.org/api/query";

/**
 * Fetches recent arXiv papers matching a search query.
 */
export async function fetchArxiv(
  query: string,
  sourceName: string = "arXiv",
  maxResults: number = 20,
  purpose: string = "ai_research"
): Promise<ArticleItem[]> {
  try {
    const response = await axios.get(ARXIV_API_BASE, {
      params: {
        search_query: query,
        start: 0,
        max_results: maxResults,
        sortBy: "submittedDate",
        sortOrder: "descending",
      },
      timeout: 15000,
      headers: { Accept: "application/xml" },
    });

    const xml = response.data as string;
    const newItems: ArticleItem[] = [];

    // Simple XML parsing for arXiv Atom feed (no heavy XML dependency)
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1] ?? "";

      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
      const publishedMatch = entry.match(/<published>([\s\S]*?)<\/published>/);

      const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
      const url = linkMatch?.[1]?.trim() ?? "";
      const publishedAt = publishedMatch?.[1]?.trim() ?? new Date().toISOString();

      if (!title || !url) continue;
      if (isProcessed(url)) continue;

      newItems.push({
        sourceName,
        sourceType: "arxiv",
        purpose,
        title,
        url: url.replace("http://", "https://"),
        publishedAt,
      });
    }

    console.log(`  📄 arXiv [${sourceName}]: ${newItems.length} new papers`);
    return newItems;
  } catch (error: any) {
    console.error(`⚠️ arXiv fetch failed: ${error.message}`);
    return [];
  }
}
