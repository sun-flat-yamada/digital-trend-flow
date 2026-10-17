/**
 * [Role] Insights report: topic trends and keyword expansion suggestions.
 * [Mechanism] Combines the trend analysis over recent daily summaries (`trend_analyzer.ts`) with
 * keyword suggestions mined from the titles in the state DB (`keyword_expansion.ts`), and saves the
 * result to `collection/insights/`. The daily run writes it and adds it to the job summary; the
 * periodic reports reuse the trend section. Deterministic: no LLM call.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../core/config";
import { PATHS } from "../core/paths";
import { analyzeTopicTrends, formatTrendAnalysis, type TopicOccurrence } from "./trend_analyzer";
import { discoverKeywordsFromHistory, type KeywordSuggestion } from "../filtering/keyword_expansion";
import { getProcessedTitles } from "../ingestion/state_manager";
import { errorMessage } from "../core/errors";

export interface InsightsReport {
  date: string;
  trends: TopicOccurrence[];
  suggestions: KeywordSuggestion[];
  markdown: string;
}

const isJapanese = (language: string): boolean => ["ja", "japanese"].includes(language.toLowerCase());

/** Keyword suggestions from the state DB: the recent window against the background before it. */
export function suggestKeywordsFromState(): KeywordSuggestion[] {
  const {
    keyword_window_days: windowDays,
    background_days: backgroundDays,
    min_document_frequency: minDf,
  } = config.settings.insights;
  const recent = getProcessedTitles(windowDays, 0);
  const background = getProcessedTitles(windowDays + backgroundDays, windowDays);
  return discoverKeywordsFromHistory(recent, background, { minDocumentFrequency: minDf, limit: 15 });
}

/** Formats the insights as Markdown (trends, then keyword suggestions). */
export function formatInsights(
  trends: TopicOccurrence[],
  suggestions: KeywordSuggestion[],
  language: string,
  trendWindowDays: number,
): string {
  const ja = isJapanese(language);
  const parts: string[] = [];

  parts.push(
    ja ? `## 📈 トピックの推移（直近 ${trendWindowDays} 日）` : `## 📈 Topic Trends (last ${trendWindowDays} days)`,
  );
  const trendSection = formatTrendAnalysis(trends, language);
  parts.push(trendSection || (ja ? "目立った変化はありません。" : "No notable change."));

  parts.push(ja ? "\n## 🔑 キーワード追加の候補" : "\n## 🔑 Keyword Suggestions");
  if (suggestions.length === 0) {
    parts.push(ja ? "候補はありません。" : "No suggestions.");
  } else {
    parts.push(
      ja
        ? "| 語 | 記事数 | 比率 | 目的 | 重み |\n|:---|:---:|:---:|:---|:---:|"
        : "| Term | Titles | Lift | Purpose | Weight |\n|:---|:---:|:---:|:---|:---:|",
    );
    for (const s of suggestions) {
      parts.push(`| ${s.word} | ${s.frequency} | ${s.lift ?? "—"} | ${s.suggestedPurpose} | ${s.suggestedWeight} |`);
    }
    parts.push(
      ja
        ? "\n> 直近に選定された記事のタイトルに繰り返し現れ、どのキーワードリストにもない語です。「比率」はその前の期間と比べた出現率の倍率です。採用する場合は `config.yml` に追加してください。"
        : '\n> Terms that recur in recently selected titles but are in no keyword list. "Lift" is their rate against the preceding period. Add the relevant ones to `config.yml`.',
    );
  }
  return parts.join("\n");
}

/** Builds the insights report for a date (trend window ending at that date). */
export function buildInsightsReport(date: string, language: string): InsightsReport {
  const windowDays = config.settings.insights.trend_window_days;
  const trends = analyzeTopicTrends(windowDays, new Date(`${date}T00:00:00Z`));
  let suggestions: KeywordSuggestion[] = [];
  try {
    suggestions = suggestKeywordsFromState();
  } catch (error) {
    console.warn(`⚠️ Keyword suggestions skipped: ${errorMessage(error)}`);
  }
  return { date, trends, suggestions, markdown: formatInsights(trends, suggestions, language, windowDays) };
}

/** Saves the insights report to `collection/insights/YYYY/` and returns its path. */
export function saveInsightsReport(
  report: InsightsReport,
  language: string,
  outputRoot: string = PATHS.ARTIFACTS_INSIGHTS.absolute,
): string {
  const dir = path.join(outputRoot, report.date.slice(0, 4));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${report.date}_digital-trend_insights.md`);
  const title = isJapanese(language) ? `インサイト ${report.date}` : `Insights ${report.date}`;
  const frontmatter = `---\ntitle: "${title}"\ndate: ${report.date}\ntype: insights\ngenerated_by: digital-trend-flow\n---\n\n`;
  fs.writeFileSync(filePath, `${frontmatter}${report.markdown}\n`, "utf8");
  console.log(`🔎 Insights report saved: ${filePath}`);
  return filePath;
}
