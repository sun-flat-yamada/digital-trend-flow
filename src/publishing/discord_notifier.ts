import axios from "axios";
import { env } from "../core/config";
import { PATHS } from "../core/paths";

/**
 * Truncates Markdown content at section boundaries to preserve document structure.
 * Prefers cutting at `---` or `## ` markers over arbitrary character positions,
 * ensuring the truncated output remains valid Markdown.
 */
function smartTruncateForDiscord(markdown: string, maxLength: number): string {
  if (markdown.length <= maxLength) return markdown;

  // Find the last section boundary before maxLength
  const candidates = [
    markdown.lastIndexOf("\n---\n", maxLength),
    markdown.lastIndexOf("\n## ", maxLength),
  ].filter((i) => i > maxLength * 0.4); // Don't cut too aggressively

  const cutPoint = candidates.length > 0
    ? Math.max(...candidates)
    : maxLength;

  return (
    markdown.slice(0, cutPoint).trim() +
    `\n\n> 📄 **全文は GitHub リポジトリの \`${PATHS.ARTIFACTS_DAILY.relative}/\` を参照してください。**`
  );
}

/**
 * Sends a summary digest to a Discord channel via Webhook.
 *
 * Discord Webhooks accept a simple POST request with a `content` field.
 * For richer formatting, we use an embed. The Markdown body is truncated
 * at section boundaries to fit Discord's 4096-character limit for embed
 * descriptions, preserving document structure.
 *
 * @param title Title of the summary (e.g., "Daily Summary 2026-03-14")
 * @param summaryMarkdown The full Markdown summary (will be truncated for Discord)
 * @param articleCount Number of articles processed
 */
export async function notifyDiscord(
  title: string,
  summaryMarkdown: string,
  articleCount: number
): Promise<void> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("ℹ️ Discord notification skipped (DISCORD_WEBHOOK_URL not set).");
    return;
  }

  try {
    // Discord embed description has a 4096 char limit.
    // Smart truncation: cut at section boundaries to preserve structure.
    const truncatedContent = smartTruncateForDiscord(summaryMarkdown, 3900);

    await axios.post(webhookUrl, {
      embeds: [
        {
          title: `📊 ${title}`,
          description: truncatedContent,
          color: 0x5865f2, // Discord blurple
          footer: {
            text: `Processed ${articleCount} articles | Obsidian HeadQuarter`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });

    console.log("✅ Discord notification sent successfully.");
  } catch (error: any) {
    // Don't crash the pipeline for a notification failure
    console.error(`⚠️ Discord notification failed: ${error.message}`);
  }
}
