/**
 * [Role] Slack notification via Webhook.
 * [Mechanism] Sends a summary digest to Slack using Incoming Webhook API, converted to Slack mrkdwn
 * and cut at a section boundary to fit a section block.
 *
 * Item: 6.4 Slack / Teams 配信
 */

import axios from "axios";
import { env } from "../core/config";
import { errorMessage } from "../core/errors";
import { markdownToSlackMrkdwn, notifyStrings, truncateAtSection } from "./notify_common";

/** Slack limits the text of a section block to 3,000 characters. */
const SLACK_SECTION_LIMIT = 3000;

/**
 * Sends a summary to Slack via Webhook.
 */
export async function notifySlack(
  title: string,
  summaryMarkdown: string,
  articleCount: number,
  language: string = "en",
): Promise<void> {
  const webhookUrl = env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("ℹ️ Slack notification skipped (SLACK_WEBHOOK_URL not set).");
    return;
  }

  try {
    const strings = notifyStrings(language);
    const text = truncateAtSection(markdownToSlackMrkdwn(summaryMarkdown), SLACK_SECTION_LIMIT, strings.fullReport);

    await axios.post(
      webhookUrl,
      {
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `📊 ${title}`, emoji: true },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `${strings.processed(articleCount)} | Digital Trend Flow`,
              },
            ],
          },
        ],
      },
      { timeout: 15000 },
    ); // a hung webhook must not stall the run

    console.log("✅ Slack notification sent successfully.");
  } catch (error) {
    console.error(`⚠️ Slack notification failed: ${errorMessage(error)}`);
  }
}
