/**
 * [Role] Atom feed of the daily summaries, published with the GitHub Pages site.
 * [Mechanism] `buildAtomFeed` is a pure function from summary entries to Atom XML. Each entry
 * links to the summary's deep link on the site (`<site>#YYYY-MM-DD`). `generatePagesSite`
 * writes the result to `feed.xml` next to `index.html`.
 *
 * Item: 6.5 RSS 出力 (feed.xml)
 */

export interface FeedEntry {
  date: string; // YYYY-MM-DD
  title: string;
  topStory: string;
  articleCount: number;
}

/** Number of most recent summaries included in the feed. */
export const FEED_ENTRY_LIMIT = 30;

/**
 * Returns the public URL of the Pages site, ending with "/".
 * `PAGES_BASE_URL` wins; otherwise the URL is derived from `GITHUB_REPOSITORY` (owner/repo).
 * Returns null when neither is set (e.g. local runs), in which case links stay relative.
 */
export function resolveSiteUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env["PAGES_BASE_URL"]?.trim();
  if (explicit) return explicit.endsWith("/") ? explicit : `${explicit}/`;
  const [owner, repo] = (env["GITHUB_REPOSITORY"] ?? "").split("/");
  if (!owner || !repo) return null;
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner.toLowerCase()}.github.io/`
    : `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

/**
 * Builds the Atom feed XML for the given entries (newest first).
 * @param siteUrl Public site URL ending with "/", or null for relative links.
 * @param updated Feed update time (ISO 8601).
 */
export function buildAtomFeed(entries: readonly FeedEntry[], siteUrl: string | null, updated: string): string {
  const base = siteUrl ?? "";
  const items = entries
    .slice(0, FEED_ENTRY_LIMIT)
    .map(
      (entry) => `  <entry>
    <title>${escapeXml(entry.title)}</title>
    <link href="${escapeXml(`${base}#${entry.date}`)}" rel="alternate" type="text/html"/>
    <id>urn:digital-trend-flow:${escapeXml(entry.date)}</id>
    <updated>${escapeXml(entry.date)}T04:00:00+09:00</updated>
    <summary>${escapeXml(entry.topStory ? `${entry.topStory} (${entry.articleCount} articles)` : `${entry.articleCount} articles`)}</summary>
  </entry>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Digital Trend Flow — Daily Summaries</title>
  <subtitle>AI-powered daily technology trend analysis</subtitle>
  <link href="${escapeXml(`${base}feed.xml`)}" rel="self" type="application/atom+xml"/>
  <link href="${escapeXml(base || "./")}" rel="alternate" type="text/html"/>
  <id>urn:digital-trend-flow:feed</id>
  <updated>${escapeXml(updated)}</updated>
  <author>
    <name>Digital Trend Flow</name>
  </author>
  <generator>Digital Trend Flow Pipeline</generator>
${items}${items ? "\n" : ""}</feed>
`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
