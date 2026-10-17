/**
 * [Role] Shared helpers for the weekly, monthly and yearly reports.
 * [Mechanism] Reads daily summaries (frontmatter + bounded body excerpt) and appends the
 * deterministic trend section to a generated report.
 */

import * as fs from "fs";
import * as yaml from "yaml";
import { analyzeTopicTrends, formatTrendAnalysis } from "./trend_analyzer";
import type { ReportKind } from "../core/plugin_registry";
import { isJapanese } from "../core/language";

export interface DailySummaryMeta {
  date: string;
  title: string;
  topStory: string;
  content: string;
  articleCount: number;
  categories: string[];
  tags: string[];
}

/** A generated periodic report, ready to be published. */
export interface PeriodicReport {
  kind: Exclude<ReportKind, "daily">;
  period: string;
  /** Last day of the period (YYYY-MM-DD). */
  endDate: string;
  title: string;
  /** Report body without frontmatter. */
  markdown: string;
  articleCount: number;
  tags: string[];
  /** Language the report was written in (OUTPUT_LANGUAGE). */
  language: string;
  outputPath: string;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Splits a Markdown file into its YAML frontmatter (parsed) and body. */
export function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {}, body: content };
  let frontmatter: Record<string, unknown> = {};
  try {
    frontmatter = (yaml.parse(match[1] ?? "") ?? {}) as Record<string, unknown>;
  } catch {
    // Malformed frontmatter: keep the body
  }
  return { frontmatter, body: content.slice(match[0].length).replace(/^\s+/, "") };
}

/** Reads one daily summary; the body is cut to `maxChars` to bound the Reduce input. */
export function readDailySummary(filePath: string, date: string, maxChars: number = 3000): DailySummaryMeta {
  const { frontmatter, body } = splitFrontmatter(fs.readFileSync(filePath, "utf8"));
  const count = Number(frontmatter["articles_processed"] ?? frontmatter["article_count"] ?? 0);
  return {
    date,
    title: typeof frontmatter["title"] === "string" ? frontmatter["title"] : `Summary ${date}`,
    topStory: typeof frontmatter["top_story"] === "string" ? frontmatter["top_story"] : "",
    content: body.slice(0, maxChars),
    articleCount: Number.isFinite(count) ? count : 0,
    categories: stringList(frontmatter["categories"]),
    tags: stringList(frontmatter["tags"]),
  };
}

/**
 * Appends the topic trend section over the `windowDays` days ending at `endDate`; the report is
 * returned unchanged when no trend stands out.
 */
export function appendTrendSection(markdown: string, endDate: string, windowDays: number, language: string): string {
  const trends = analyzeTopicTrends(windowDays, new Date(`${endDate}T00:00:00Z`));
  const section = formatTrendAnalysis(trends, language);
  if (!section) return markdown;
  const heading = isJapanese(language)
    ? `## 📐 トピックの推移（日次サマリーの集計・直近 ${windowDays} 日）`
    : `## 📐 Topic Trends (from the daily summaries, last ${windowDays} days)`;
  return `${markdown.trim()}\n\n${heading}\n\n${section}\n`;
}

/** Most frequent values first (ties keep first-seen order). */
export function rankByFrequency(values: readonly string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v);
}
