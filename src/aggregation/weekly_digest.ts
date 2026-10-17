/**
 * [Role] Weekly digest generation from daily summaries.
 * [Mechanism] Reads the daily summaries of an ISO week (e.g. "2026-W38", or any date in it),
 * passes bounded excerpts to the Reduce model to write the weekly trend report, and appends the
 * deterministic topic trend section (this week against the previous one).
 * Run by `.github/workflows/weekly_digest.yml` through `src/cli/report.ts`.
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";
import { llmCall } from "../summarization/llm_gateway";
import { getWeeklyReducePrompt } from "../summarization/prompts";
import { saveMarkdownFile } from "../storage/markdown_builder";
import { config } from "../core/config";
import {
  appendTrendSection,
  rankByFrequency,
  readDailySummary,
  type DailySummaryMeta,
  type PeriodicReport,
} from "./periodic_common";
import { errorMessage } from "../core/errors";

/**
 * Calculates the ISO week string (e.g. "2026-W38") for a given Date.
 */
export function getIsoWeekString(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Calculates the start and end dates (YYYY-MM-DD) for an ISO week string (e.g. "2026-W38").
 */
export function getDatesForIsoWeek(isoWeek: string): { startDate: string; endDate: string } {
  const [yearStr, weekStr] = isoWeek.split("-W") as [string, string];
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);

  // Jan 4th is always in week 1 of ISO-8601
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // 1=Mon, 7=Sun
  const firstMonday = new Date(jan4.getTime() - (dayOfWeek - 1) * 86400000);

  const start = new Date(firstMonday.getTime() + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/** Resolves "2026-W38" or a date in the week to the ISO week and its first and last day. */
export function resolveWeek(weekParam: string): { isoWeek: string; startDate: string; endDate: string } {
  const isoWeek = /^\d{4}-W\d{2}$/.test(weekParam) ? weekParam : getIsoWeekString(new Date(`${weekParam}T00:00:00Z`));
  if (!/^\d{4}-W\d{2}$/.test(isoWeek)) {
    throw new Error(`Invalid week "${weekParam}": use "YYYY-Www" or a date "YYYY-MM-DD"`);
  }
  return { isoWeek, ...getDatesForIsoWeek(isoWeek) };
}

/** Daily summary files under `dailyRoot` whose date falls in [startDate, endDate]. */
function findDailySummaries(
  dailyRoot: string,
  startDate: string,
  endDate: string,
): { date: string; filePath: string }[] {
  const found: { date: string; filePath: string }[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})_digital-trend_daily_summary\.md$/);
      if (match?.[1] && match[1] >= startDate && match[1] <= endDate) {
        found.push({ date: match[1], filePath: full });
      }
    }
  };
  walk(dailyRoot);
  return found.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Generates a weekly digest by aggregating daily summaries.
 * Resolves with null when the week has no daily summaries; throws when generation fails.
 * @param weekParam Format: "2026-W38" or a date "2026-09-20"
 */
export async function generateWeeklyDigest(weekParam: string): Promise<PeriodicReport | null> {
  const { isoWeek, startDate, endDate } = resolveWeek(weekParam);
  const year = isoWeek.slice(0, 4);

  const dailyRoot = PATHS.ARTIFACTS_DAILY.absolute;
  if (!fs.existsSync(dailyRoot)) {
    console.warn(`⚠️ Daily artifacts directory not found: ${dailyRoot}`);
    return null;
  }

  const matchedSummaries: DailySummaryMeta[] = findDailySummaries(dailyRoot, startDate, endDate).map((f) =>
    readDailySummary(f.filePath, f.date),
  );

  if (matchedSummaries.length === 0) {
    console.log(`ℹ️ No daily summaries found for week ${isoWeek} (${startDate} ~ ${endDate}). Skipping weekly digest.`);
    return null;
  }

  console.log(
    `📅 Generating weekly digest for ${isoWeek} (${matchedSummaries.length} daily summaries, ${startDate} ~ ${endDate})`,
  );

  const totalArticles = matchedSummaries.reduce((sum, d) => sum + d.articleCount, 0);
  const allCategories = [...new Set(matchedSummaries.flatMap((d) => d.categories))];
  const tags = rankByFrequency(
    matchedSummaries.flatMap((d) => d.tags),
    10,
  );

  const factsPayload = matchedSummaries.map((d) => ({
    date: d.date,
    content_excerpt: d.content.slice(0, 2000),
    article_count: d.articleCount,
  }));

  const userPrompt = `Week: ${isoWeek} (${startDate} to ${endDate})
Total daily summaries: ${matchedSummaries.length}
Total articles processed: ${totalArticles}
Active categories: ${allCategories.join(", ")}

Here are excerpts from each daily summary across this week:

${JSON.stringify(factsPayload, null, 2)}

Generate a comprehensive weekly trend analysis report.`;

  let reportText: string;
  try {
    const response = await llmCall({
      systemPrompt: getWeeklyReducePrompt(),
      userPrompt,
      phase: "reduce",
      maxOutputTokens: 16384,
    });
    reportText = response.text;
  } catch (error) {
    // Throw rather than return null: null means "no daily summaries", which the workflow treats
    // as success, so an LLM failure would otherwise go unnoticed.
    throw new Error(`Weekly digest generation failed for ${isoWeek}: ${errorMessage(error)}`, { cause: error });
  }

  // This week against the previous one
  const markdown = appendTrendSection(reportText, endDate, 14);
  const filename = `${endDate}_digital-trend_weekly_report.md`;
  const title = `Weekly Trend Report ${isoWeek} (${startDate} ~ ${endDate})`;

  const outputDir = path.join(PATHS.ARTIFACTS_WEEKLY.absolute, year);
  const outputPath = saveMarkdownFile(outputDir, filename, title, markdown, totalArticles, config.settings.author, {
    tags,
    categories: allCategories,
    sources: [`${matchedSummaries.length} daily summaries (${startDate} ~ ${endDate})`],
    type: "weekly_report",
    period: isoWeek,
  });

  console.log(`✅ Weekly digest generated: ${outputPath}`);
  return { kind: "weekly", period: isoWeek, endDate, title, markdown, articleCount: totalArticles, tags, outputPath };
}
