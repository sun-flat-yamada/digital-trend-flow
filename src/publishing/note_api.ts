/**
 * [Role] Zenn.dev article publishing integration.
 * [Mechanism] Uses Zenn's GitHub-based publishing workflow to create draft
 * articles. Falls back to note.com stub if Zenn is not configured.
 *
 * Item: 6.2 note.com / Zenn 連携
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";

/**
 * Publishes a summary as a Zenn article draft file.
 * Zenn uses a "articles/" directory in a GitHub repo — this generates
 * the properly formatted Markdown file for Zenn CLI to publish.
 *
 * @param slug Article slug (e.g., "2026-04-12-daily")
 * @param title Article title
 * @param content Markdown content
 * @param topics Tags/topics for the article
 */
export function createZennDraft(
  slug: string,
  title: string,
  content: string,
  topics: string[] = ["AI", "Tech"]
): string {
  const outputDir = PATHS.ARTIFACTS_ZENN.absolute;
  fs.mkdirSync(outputDir, { recursive: true });

  const topicList = topics.slice(0, 5).map((t) => `"${t}"`).join(", ");

  const zennMarkdown = `---
title: "${title}"
emoji: "📊"
type: "tech"
topics: [${topicList}]
published: false
---

${content}
`;

  const filePath = path.join(outputDir, `${slug}.md`);
  fs.writeFileSync(filePath, zennMarkdown, "utf8");
  console.log(`📝 Zenn draft created: ${filePath}`);
  return filePath;
}

/**
 * Publishes a summary to note.com as a draft article.
 * NOTE: note.com does not have a public API. This is a placeholder.
 */
export async function publishToNote(
  title: string,
  content: string,
  _isPaid: boolean = false
): Promise<void> {
  console.log(`ℹ️ note.com publishing is not yet implemented. Would publish: "${title}" (${content.length} chars)`);
  // TODO: Implement via Playwright browser automation when needed
}
