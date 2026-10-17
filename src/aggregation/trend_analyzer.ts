/**
 * [Role] Temporal trend detection across daily summaries.
 * [Mechanism] Reads the frontmatter of the daily summaries in a window (tags, mentioned companies
 * and technologies), counts on how many days each topic appears in the older and the recent half
 * of the window, and classifies it as rising, stable, declining or new. Deterministic: no LLM call.
 * Used by the daily insights report and the weekly / monthly / yearly reports.
 *
 * Item: 8.1 時系列トレンド検出
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { PATHS } from "../core/paths";

export interface TopicOccurrence {
  topic: string;
  dates: string[];
  totalMentions: number;
  recentMentions: number;
  olderMentions: number;
  trend: "rising" | "stable" | "declining" | "new";
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD of a date, in UTC (the edition dates of the daily summaries). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Topics of one daily summary: its tags, mentioned companies and technologies (deduplicated). */
export function extractSummaryTopics(fileContent: string): string[] {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return [];
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = (yaml.parse(match[1]) ?? {}) as Record<string, unknown>;
  } catch {
    return [];
  }
  const topics = new Map<string, string>(); // lowercase -> first spelling seen
  for (const field of ["tags", "mentioned_companies", "mentioned_technologies"]) {
    const values = frontmatter[field];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== "string" || value.trim() === "") continue;
      const key = value.trim().toLowerCase();
      if (!topics.has(key)) topics.set(key, value.trim());
    }
  }
  return [...topics.values()];
}

/**
 * Scans the daily summaries of the `daysBack` days ending at `endDate` (inclusive) and classifies
 * each topic that appears on at least two days.
 */
export function analyzeTopicTrends(
  daysBack: number = 30,
  endDate: Date = new Date(),
  dailyDir: string = PATHS.ARTIFACTS_DAILY.absolute,
): TopicOccurrence[] {
  if (!fs.existsSync(dailyDir)) return [];

  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const halfway = isoDate(new Date(end - Math.floor(daysBack / 2) * DAY_MS));
  const topicDates = new Map<string, Set<string>>();
  const spelling = new Map<string, string>();

  for (let i = 0; i < daysBack; i++) {
    const date = isoDate(new Date(end - i * DAY_MS));
    const [yyyy, mm] = date.split("-") as [string, string];
    const filePath = path.join(dailyDir, yyyy, mm, `${date}_digital-trend_daily_summary.md`);
    if (!fs.existsSync(filePath)) continue;
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const topic of extractSummaryTopics(content)) {
      const key = topic.toLowerCase();
      if (!spelling.has(key)) spelling.set(key, topic);
      const dates = topicDates.get(key) ?? new Set<string>();
      dates.add(date);
      topicDates.set(key, dates);
    }
  }

  const results: TopicOccurrence[] = [];
  for (const [key, dateSet] of topicDates) {
    if (dateSet.size < 2) continue; // a one-off mention is not a trend
    const dates = [...dateSet].sort();
    const recentMentions = dates.filter((d) => d > halfway).length;
    const olderMentions = dates.length - recentMentions;

    let trend: TopicOccurrence["trend"];
    if (olderMentions === 0) trend = "new";
    else if (recentMentions > olderMentions * 1.5) trend = "rising";
    else if (recentMentions < olderMentions * 0.5) trend = "declining";
    else trend = "stable";

    results.push({
      topic: spelling.get(key) ?? key,
      dates,
      totalMentions: dates.length,
      recentMentions,
      olderMentions,
      trend,
    });
  }

  return results.sort((a, b) => b.totalMentions - a.totalMentions || a.topic.localeCompare(b.topic)).slice(0, 50);
}

const isJapanese = (language: string): boolean => ["ja", "japanese"].includes(language.toLowerCase());

/**
 * Formats the trend analysis as a Markdown section body (`###` headings). Returns "" when there
 * is nothing to report.
 */
export function formatTrendAnalysis(trends: TopicOccurrence[], language: string = "ja"): string {
  const ja = isJapanese(language);
  const rising = trends.filter((t) => t.trend === "rising");
  const newTopics = trends.filter((t) => t.trend === "new");
  const declining = trends.filter((t) => t.trend === "declining");

  const parts: string[] = [];

  if (rising.length > 0) {
    parts.push(ja ? "### 📈 上昇トレンド" : "### 📈 Rising");
    for (const t of rising.slice(0, 10)) {
      parts.push(
        ja
          ? `- **${t.topic}**: ${t.totalMentions}日で言及（前半 ${t.olderMentions} → 後半 ${t.recentMentions}）`
          : `- **${t.topic}**: mentioned on ${t.totalMentions} days (${t.olderMentions} → ${t.recentMentions})`,
      );
    }
  }

  if (newTopics.length > 0) {
    parts.push(ja ? "\n### 🆕 新規トピック" : "\n### 🆕 New");
    for (const t of newTopics.slice(0, 10)) {
      parts.push(
        ja
          ? `- **${t.topic}**: ${t.totalMentions}日で言及（期間の後半に初出）`
          : `- **${t.topic}**: mentioned on ${t.totalMentions} days (first seen in the recent half)`,
      );
    }
  }

  if (declining.length > 0) {
    parts.push(ja ? "\n### 📉 下降トレンド" : "\n### 📉 Declining");
    for (const t of declining.slice(0, 5)) {
      parts.push(
        ja
          ? `- **${t.topic}**: ${t.totalMentions}日で言及（前半 ${t.olderMentions} → 後半 ${t.recentMentions}）`
          : `- **${t.topic}**: mentioned on ${t.totalMentions} days (${t.olderMentions} → ${t.recentMentions})`,
      );
    }
  }

  return parts.join("\n").trim();
}
