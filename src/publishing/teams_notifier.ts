/**
 * [Role] Microsoft Teams notification via Webhook.
 * [Mechanism] Sends a summary digest to Teams using Incoming Webhook.
 *
 * Item: 6.4 Slack / Teams 配信
 */

import axios from "axios";
import { env } from "../core/config";

/**
 * Sends a summary to Microsoft Teams via Webhook.
 */
export async function notifyTeams(
  title: string,
  summaryMarkdown: string,
  articleCount: number
): Promise<void> {
  const webhookUrl = env.TEAMS_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("ℹ️ Teams notification skipped (TEAMS_WEBHOOK_URL not set).");
    return;
  }

  try {
    const truncated = summaryMarkdown.length > 5000
      ? summaryMarkdown.slice(0, 5000).trim() + "\n\n> 📄 全文は GitHub リポジトリを参照してください。"
      : summaryMarkdown;

    await axios.post(webhookUrl, {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: `📊 ${title}`,
                weight: "bolder",
                size: "large",
              },
              {
                type: "TextBlock",
                text: truncated,
                wrap: true,
              },
              {
                type: "TextBlock",
                text: `Processed ${articleCount} articles | Digital Trend Flow`,
                size: "small",
                isSubtle: true,
              },
            ],
          },
        },
      ],
    });

    console.log("✅ Teams notification sent successfully.");
  } catch (error: any) {
    console.error(`⚠️ Teams notification failed: ${error.message}`);
  }
}
