/**
 * [Role] GitHub Trending repositories ingestion module.
 * [Mechanism] Fetches the GitHub Trending page and parses it with cheerio, one repository row
 * (`article.Box-row`) at a time, so each repository keeps its own description and star count.
 *
 * Item: 2.3 New Source Types (GitHub Trending)
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { isProcessed } from "./state_manager";
import type { ArticleItem } from "../core/types";
import { errorMessage } from "../core/errors";

const GITHUB_TRENDING_URL = "https://github.com/trending";
const MAX_ITEMS = 25;

/** One repository row of the Trending page. */
export interface TrendingRepo {
  repoPath: string; // "owner/repo"
  description?: string;
  language?: string;
  starsToday: number;
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Parses the Trending page. Every field is read inside the repository's own row, so a repository
 * without a description gets none (instead of the next repository's).
 */
export function parseTrendingPage(html: string): TrendingRepo[] {
  const $ = cheerio.load(html);
  const repos: TrendingRepo[] = [];
  const seen = new Set<string>();

  $("article.Box-row").each((_, row) => {
    const $row = $(row);
    const href = $row.find("h2 a").first().attr("href") ?? "";
    const repoPath = href.replace(/^\//, "").trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repoPath) || seen.has(repoPath)) return;
    seen.add(repoPath);

    const description = collapse($row.children("p").first().text());
    const language = collapse($row.find('[itemprop="programmingLanguage"]').first().text());
    const starsText = $row
      .find("span")
      .toArray()
      .map((span) => collapse($(span).text()))
      .find((text) => /stars? today/i.test(text));
    const starsToday = Number(starsText?.match(/([\d,]+)\s+stars? today/i)?.[1]?.replace(/,/g, "") ?? 0);

    repos.push({
      repoPath,
      ...(description ? { description } : {}),
      ...(language ? { language } : {}),
      starsToday,
    });
  });

  return repos;
}

/**
 * Fetches trending GitHub repositories. Throws when the page has no repository row, which is how
 * a change in GitHub's markup shows up (rather than as a silently empty source).
 */
export async function fetchGitHubTrending(
  sourceName: string = "GitHub Trending",
  languageFilter?: string,
  since: string = "daily",
  purpose: string = "ai_dev_tools",
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

    const repos = parseTrendingPage(String(response.data));
    if (repos.length === 0) {
      throw new Error("the page contained no repositories (the page markup may have changed)");
    }

    const newItems: ArticleItem[] = [];
    for (const repo of repos) {
      const repoUrl = `https://github.com/${repo.repoPath}`;
      if (isProcessed(repoUrl)) continue;

      newItems.push({
        sourceName,
        sourceType: "github_trending",
        purpose,
        title: repo.repoPath,
        url: repoUrl,
        publishedAt: new Date().toISOString(),
        ...(repo.description ? { description: repo.description } : {}),
        engagement: { starsToday: repo.starsToday },
      });

      if (newItems.length >= MAX_ITEMS) break;
    }

    console.log(`  🐙 GitHub [${sourceName}]: ${newItems.length} trending repos`);
    return newItems;
  } catch (error) {
    // Propagate, so the run records the source as failing rather than empty.
    throw new Error(`GitHub Trending fetch failed: ${errorMessage(error)}`, { cause: error });
  }
}
