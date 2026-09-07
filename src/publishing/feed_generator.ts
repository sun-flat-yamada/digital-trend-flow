/**
 * [Role] RSS/Atom feed generation for output syndication.
 * [Mechanism] Generates an Atom feed XML from daily summaries so that
 * users can subscribe to pipeline output via RSS readers.
 *
 * Item: 6.5 RSS 出力 (feed.xml)
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";

interface FeedEntry {
  title: string;
  date: string;
  filename: string;
  articleCount: number;
}

/**
 * Generates an Atom feed XML from existing daily summaries.
 * @param outputDir Directory containing daily summary files
 * @param baseUrl Base URL for the feed (e.g., GitHub Pages URL)
 */
export function generateAtomFeed(
  outputDir: string = PATHS.ARTIFACTS_DAILY.absolute,
  baseUrl: string = "https://github.com"
): string {
  const absoluteDir = path.resolve(process.cwd(), outputDir);
  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
  }

  // Scan for past 30 days
  const entries: FeedEntry[] = [];
  try {
    for (let i = 0; i < 30; i++) {
        const d = new Date(Date.now() - i * 86400000);
        const yyyy = d.getFullYear().toString();
        const mm = (d.getMonth() + 1).toString().padStart(2, "0");
        const dd = d.getDate().toString().padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const relativeFile = `${yyyy}/${mm}/${dateStr}_digital-trend_daily_summary.md`;
        const filePath = path.join(absoluteDir, yyyy, mm, `${dateStr}_digital-trend_daily_summary.md`);

        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf8");
          const dateMatch = path.basename(filePath).match(/^(\d{4}-\d{2}-\d{2})/);
          const titleMatch = content.match(/^title:\s*(.+)$/m);
          const countMatch = content.match(/^articles_processed:\s*(\d+)$/m);

          entries.push({
            title: titleMatch?.[1]?.replace(/["']/g, "") ?? `Daily Summary ${dateMatch?.[1] ?? ""}`,
            date: dateMatch?.[1] ?? dateStr,
            filename: relativeFile,
            articleCount: parseInt(countMatch?.[1] ?? "0", 10),
          });
        }
    }
  } catch {
    // Directory may not exist yet
  }

  const now = new Date().toISOString();
  const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Digital Trend Flow — Daily Summaries</title>
  <subtitle>AI-powered daily technology trend analysis</subtitle>
  <link href="${baseUrl}/${PATHS.ARTIFACTS_DAILY.relative}/feed.xml" rel="self" type="application/atom+xml"/>
  <link href="${baseUrl}" rel="alternate" type="text/html"/>
  <id>urn:digital-trend-flow:feed</id>
  <updated>${now}</updated>
  <author>
    <name>Digital Trend Flow</name>
  </author>
  <generator>Digital Trend Flow Pipeline</generator>
${entries
  .map(
    (entry) => `  <entry>
    <title>${escapeXml(entry.title)}</title>
    <link href="${baseUrl}/${PATHS.ARTIFACTS_DAILY.relative}/${entry.filename}" rel="alternate" type="text/html"/>
    <id>urn:digital-trend-flow:${entry.date}</id>
    <updated>${entry.date}T04:00:00+09:00</updated>
    <summary>${entry.articleCount} articles processed</summary>
  </entry>`
  )
  .join("\n")}
</feed>
`;

  const feedPath = path.join(absoluteDir, "feed.xml");
  fs.writeFileSync(feedPath, feedXml, "utf8");
  console.log(`📡 Atom feed generated: ${feedPath}`);
  return feedPath;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
