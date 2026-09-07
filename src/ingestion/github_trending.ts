/**
 * [Role] GitHub Trending repositories ingestion module.
 * [Mechanism] Scrapes the GitHub Trending page via a lightweight HTML
 * parser to extract trending repos as ArticleItems.
 *
 * Item: 2.3 New Source Types (GitHub Trending)
 */

import axios from "axios";
import { isProcessed } from "./state_manager";
import { ArticleItem } from "./rss";

const GITHUB_TRENDING_URL = "https://github.com/trending";

/**
 * Fetches trending GitHub repositories.
 */
export async function fetchGitHubTrending(
  sourceName: string = "GitHub Trending",
  languageFilter?: string,
  since: string = "daily",
  purpose: string = "ai_dev_tools"
): Promise<ArticleItem[]> {
  try {
    let url = GITHUB_TRENDING_URL;
    if (languageFilter) url += `/${encodeURIComponent(languageFilter)}`;
    url += `?since=${since}`;

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DigitalTrendFlow/1.0)",
        Accept: "text/html",
      },
    });

    const html = response.data as string;
    const newItems: ArticleItem[] = [];

    // Extract repo links from the trending page HTML
    // Pattern: <h2 class="..."><a href="/owner/repo" ...>
    const repoRegex = /<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"[^>]*>/g;
    let match;
    const seen = new Set<string>();

    while ((match = repoRegex.exec(html)) !== null) {
      const repoPath = match[1]?.trim();
      if (!repoPath || seen.has(repoPath)) continue;
      seen.add(repoPath);

      const repoUrl = `https://github.com/${repoPath}`;
      if (isProcessed(repoUrl)) continue;

      // Extract description if available
      const descRegex = new RegExp(
        `href="/${repoPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?<p[^>]*class="[^"]*"[^>]*>\\s*([^<]+)`,
        "m"
      );
      const descMatch = html.match(descRegex);
      const description = descMatch?.[1]?.trim() ?? "";

      // Extract stars count
      const starsRegex = new RegExp(
        `${repoPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(\\d[\\d,]*) stars today`,
        "m"
      );
      const starsMatch = html.match(starsRegex);
      const stars = starsMatch?.[1]?.replace(/,/g, "") ?? "0";

      newItems.push({
        sourceName,
        sourceType: "github_trending",
        purpose,
        title: `⭐ ${repoPath} — ${description || "Trending repo"} (★${stars}/day)`,
        url: repoUrl,
        publishedAt: new Date().toISOString(),
      });

      if (newItems.length >= 25) break;
    }

    console.log(`  🐙 GitHub [${sourceName}]: ${newItems.length} trending repos`);
    return newItems;
  } catch (error: any) {
    console.error(`⚠️ GitHub Trending fetch failed: ${error.message}`);
    return [];
  }
}
