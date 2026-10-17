/**
 * [Role] Microsoft Teams notification via Webhook.
 * [Mechanism] Sends a summary digest to Teams using Incoming Webhook.
 *
 * Item: 6.4 Slack / Teams 配信
 */

import axios from "axios";
import { env } from "../core/config";
import { errorMessage } from "../core/errors";
import { notifyStrings, truncateAtSection } from "./notify_common";

/**
 * Sends a summary to Microsoft Teams via Webhook.
 */
export async function notifyTeams(
  title: string,
  summaryMarkdown: string,
  articleCount: number,
  language: string = "en",
): Promise<void> {
  const webhookUrl = env.TEAMS_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("ℹ️ Teams notification skipped (TEAMS_WEBHOOK_URL not set).");
    return;
  }

  try {
    const strings = notifyStrings(language);
    const truncated = truncateAtSection(summaryMarkdown, 5000, strings.fullReport);

    await axios.post(
      webhookUrl,
      {
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
                  text: `${strings.processed(articleCount)} | Digital Trend Flow`,
                  size: "small",
                  isSubtle: true,
                },
              ],
            },
          },
        ],
      },
      { timeout: 15000 },
    ); // a hung webhook must not stall the run

    console.log("✅ Teams notification sent successfully.");
  } catch (error) {
    console.error(`⚠️ Teams notification failed: ${errorMessage(error)}`);
  }
}
