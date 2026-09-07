/**
 * [Role] Slack notification via Webhook.
 * [Mechanism] Sends a summary digest to Slack using Incoming Webhook API.
 *
 * Item: 6.4 Slack / Teams 配信
 */

import axios from "axios";
import { env } from "../core/config";

/**
 * Sends a summary to Slack via Webhook.
 */
export async function notifySlack(
  title: string,
  summaryMarkdown: string,
  articleCount: number
): Promise<void> {
  const webhookUrl = env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("ℹ️ Slack notification skipped (SLACK_WEBHOOK_URL not set).");
    return;
  }

  try {
    // Truncate for Slack's 3000 char block limit
    const truncated = summaryMarkdown.length > 2800
      ? summaryMarkdown.slice(0, 2800).trim() + "\n\n> 📄 全文は GitHub リポジトリを参照してください。"
      : summaryMarkdown;

    await axios.post(webhookUrl, {
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `📊 ${title}`, emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: truncated },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Processed ${articleCount} articles | Digital Trend Flow`,
            },
          ],
        },
      ],
    });

    console.log("✅ Slack notification sent successfully.");
  } catch (error: any) {
    console.error(`⚠️ Slack notification failed: ${error.message}`);
  }
}
