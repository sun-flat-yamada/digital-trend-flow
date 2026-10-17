/**
 * [Role] Helpers shared by the webhook and email notifiers.
 * [Mechanism] Boilerplate in the report's language, truncation at a section boundary, and
 * Markdown → Slack mrkdwn conversion.
 */

import { isJapanese } from "../core/language";
import { PATHS } from "../core/paths";

export interface NotifyStrings {
  /** Appended when the body is cut. */
  fullReport: string;
  /** e.g. "Processed 5 articles". */
  processed: (count: number) => string;
  /** e.g. "5 articles" (email subject). */
  articles: (count: number) => string;
  /** Email footer. */
  emailFooter: string;
}

/** Notification boilerplate: Japanese for a Japanese report, English for any other language. */
export function notifyStrings(language: string = "en"): NotifyStrings {
  const dir = `${PATHS.ARTIFACTS_DAILY.relative}/`;
  return isJapanese(language)
    ? {
        fullReport: `📄 全文は GitHub リポジトリの \`${dir}\` を参照してください。`,
        processed: (count) => `${count} 件の記事を処理`,
        articles: (count) => `${count} 件`,
        emailFooter: "Digital Trend Flow — トレンドの自動収集と要約",
      }
    : {
        fullReport: `📄 Read the full report in the GitHub repository (\`${dir}\`).`,
        processed: (count) => `Processed ${count} articles`,
        articles: (count) => `${count} articles`,
        emailFooter: "Digital Trend Flow — Automated Trend Harvesting & Summarization",
      };
}

/**
 * Cuts `text` so that, with `notice` appended, it fits in `maxLength` characters. The cut is made at
 * the last section boundary (a `---` rule or a heading) in the second half of the allowed length,
 * else at the last blank line or line break there, else at the limit.
 */
export function truncateAtSection(text: string, maxLength: number, notice: string): string {
  if (text.length <= maxLength) return text;
  const budget = Math.max(0, maxLength - notice.length - 2);
  const head = text.slice(0, budget);
  const minCut = budget * 0.4; // don't cut too aggressively
  const lastOf = (pattern: RegExp): number => {
    let last = -1;
    for (const m of head.matchAll(pattern)) last = m.index;
    return last > minCut ? last : -1;
  };
  const cut = [/\n---\n/g, /\n#{1,6} /g, /\n\*[^\n*]+\*\n/g, /\n\n/g, /\n/g].map(lastOf).find((i) => i > 0);
  return `${head.slice(0, cut ?? budget).trimEnd()}\n\n${notice}`;
}

const escapeSlack = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline Markdown → mrkdwn: links `<url|text>`, bold `*text*`, italic `_text_`. */
function inlineToMrkdwn(text: string): string {
  const BOLD = "\u0000";
  return escapeSlack(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => `<${url}|${label}>`)
    .replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${BOLD}`)
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, "$1_$2_")
    .replace(new RegExp(BOLD, "g"), "*");
}

/**
 * Converts Markdown to Slack mrkdwn (https://api.slack.com/reference/surfaces/formatting): headings
 * become bold lines, `-` / `*` bullets become "•", `---` becomes a divider line; quotes are kept.
 */
export function markdownToSlackMrkdwn(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading?.[1]) return `*${inlineToMrkdwn(heading[1].replace(/\*\*/g, "")).trim()}*`;
      if (/^\s*-{3,}\s*$/.test(line)) return "──────────";
      const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (bullet) return `${bullet[1] ?? ""}• ${inlineToMrkdwn(bullet[2] ?? "")}`;
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) return `> ${inlineToMrkdwn(quote[1] ?? "")}`;
      return inlineToMrkdwn(line);
    })
    .join("\n");
}
