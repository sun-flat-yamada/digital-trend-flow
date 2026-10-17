/**
 * [Role] Monthly digest generation from daily summaries.
 * [Mechanism] Reads daily summary Markdown files for a given month,
 * extracts facts and metadata, then uses Reduce phase to generate
 * a monthly trend analysis, followed by the deterministic topic trend section
 * (this month against the previous one).
 * Run by `.github/workflows/monthly_digest.yml` through `src/cli/report.ts`.
 *
 * Item: 6.1 月次ダイジェスト実装
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";
import { llmCall } from "../summarization/llm_gateway";
import { getMonthlyReducePrompt } from "../summarization/prompts";
import { saveMarkdownFile } from "../storage/markdown_builder";
import { config } from "../core/config";
import { outputLanguage } from "../core/language";
import { metrics } from "../core/metrics";
import { appendTrendSection, rankByFrequency, readDailySummary, type PeriodicReport } from "./periodic_common";
import { errorMessage } from "../core/errors";

/** Number of days of a month ("2026-02" → 28). */
export function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Generates a monthly digest by aggregating daily summaries.
 * Resolves with null when the month has no daily summaries; throws when generation fails.
 * @param yearMonth Format: "2026-04"
 */
export async function generateMonthlyDigest(yearMonth: string): Promise<PeriodicReport | null> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`Invalid month "${yearMonth}": use "YYYY-MM"`);
  }
  const [year, month] = yearMonth.split("-") as [string, string];
  const dailyDir = path.join(PATHS.ARTIFACTS_DAILY.absolute, year, month);
  if (!fs.existsSync(dailyDir)) {
    console.warn(`⚠️ No daily summaries found for monthly digest at ${dailyDir}.`);
    return null;
  }

  // Find all daily summaries for the given month
  const dailyFiles = fs
    .readdirSync(dailyDir)
    .filter((f) => f.startsWith(yearMonth) && f.endsWith("_digital-trend_daily_summary.md"))
    .sort();

  if (dailyFiles.length === 0) {
    console.log(`ℹ️ No daily summaries found for ${yearMonth}. Skipping monthly digest.`);
    return null;
  }

  console.log(`📅 Generating monthly digest for ${yearMonth} (${dailyFiles.length} daily summaries)`);

  // Extract content from each daily summary (truncated per day to fit context)
  const dailySummaries = dailyFiles.map((file) =>
    readDailySummary(path.join(dailyDir, file), file.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? ""),
  );

  // Build the reduce input
  const totalArticles = dailySummaries.reduce((sum, d) => sum + d.articleCount, 0);
  const allCategories = [...new Set(dailySummaries.flatMap((d) => d.categories))];
  const tags = rankByFrequency(
    dailySummaries.flatMap((d) => d.tags),
    10,
  );

  const factsPayload = dailySummaries.map((d) => ({
    date: d.date,
    content_excerpt: d.content.slice(0, 2000),
    article_count: d.articleCount,
  }));

  const userPrompt = `Month: ${yearMonth}
Total daily summaries: ${dailyFiles.length}
Total articles processed: ${totalArticles}
Active categories: ${allCategories.join(", ")}

Here are excerpts from each daily summary:

${JSON.stringify(factsPayload, null, 2)}

Generate a comprehensive monthly trend analysis.`;

  const language = outputLanguage();
  let reportText: string;
  try {
    const response = await llmCall({
      systemPrompt: getMonthlyReducePrompt(language),
      userPrompt,
      phase: "reduce",
      maxOutputTokens: 16384,
    });
    reportText = response.text;
  } catch (error) {
    // Throw rather than return null: null means "no daily summaries", which the workflow treats
    // as success, so an LLM failure would otherwise go unnoticed.
    throw new Error(`Monthly digest generation failed for ${yearMonth}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  // This month against the previous one
  const endDate = `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, "0")}`;
  const markdown = appendTrendSection(reportText, endDate, daysInMonth(yearMonth) * 2, language);

  // Save monthly digest
  const today = new Date().toISOString().split("T")[0] ?? yearMonth + "-01";
  const filename = `${today}_digital-trend_monthly_report.md`;
  const title = `Monthly Digest ${yearMonth}`;

  const outputDir = path.join(PATHS.ARTIFACTS_MONTHLY.absolute, year);
  const outputPath = saveMarkdownFile(outputDir, filename, title, markdown, totalArticles, config.settings.author, {
    tags,
    categories: allCategories,
    sources: [`${dailyFiles.length} daily summaries`],
    type: "monthly_report",
    period: yearMonth,
    language,
    prompts: metrics.getSnapshot().prompts,
  });

  console.log(`✅ Monthly digest generated: ${outputPath}`);
  return {
    kind: "monthly",
    period: yearMonth,
    endDate,
    title,
    markdown,
    articleCount: totalArticles,
    tags,
    language,
    outputPath,
  };
}
