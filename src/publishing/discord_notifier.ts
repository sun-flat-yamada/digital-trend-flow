import axios from "axios";
import { env } from "../core/config";
import { errorMessage } from "../core/errors";
import { notifyStrings, truncateAtSection } from "./notify_common";

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
 * @param language Language of the report; the boilerplate is Japanese for "ja", English otherwise
 */
export async function notifyDiscord(
  title: string,
  summaryMarkdown: string,
  articleCount: number,
  language: string = "en",
): Promise<void> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("ℹ️ Discord notification skipped (DISCORD_WEBHOOK_URL not set).");
    return;
  }

  try {
    // Discord embed description has a 4096 char limit.
    // Smart truncation: cut at section boundaries to preserve structure.
    const strings = notifyStrings(language);
    const truncatedContent = truncateAtSection(summaryMarkdown, 3900, `> ${strings.fullReport}`);

    await axios.post(
      webhookUrl,
      {
        embeds: [
          {
            title: `📊 ${title}`,
            description: truncatedContent,
            color: 0x5865f2, // Discord blurple
            footer: {
              text: `${strings.processed(articleCount)} | Obsidian HeadQuarter`,
            },
            timestamp: new Date().toISOString(),
          },
        ],
      },
      { timeout: 15000 },
    ); // a hung webhook must not stall the run

    console.log("✅ Discord notification sent successfully.");
  } catch (error) {
    // Don't crash the pipeline for a notification failure
    console.error(`⚠️ Discord notification failed: ${errorMessage(error)}`);
  }
}
