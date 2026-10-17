/**
 * [Role] Yearly report generation.
 * [Mechanism] Aggregates the year's monthly digests (bounded excerpts) and the top story of every
 * daily summary of the year, and has the Reduce model write the yearly report (Map-Reduce: the
 * monthly digests are already the reduced form of the daily summaries). The deterministic topic
 * trend section (second half of the year against the first) is appended.
 * Run by `.github/workflows/yearly_report.yml` through `src/cli/report.ts`.
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";
import { config } from "../core/config";
import { outputLanguage } from "../core/language";
import { metrics } from "../core/metrics";
import { llmCall } from "../summarization/llm_gateway";
import { getYearlyReducePrompt } from "../summarization/prompts";
import { saveMarkdownFile } from "../storage/markdown_builder";
import {
  appendTrendSection,
  rankByFrequency,
  readDailySummary,
  splitFrontmatter,
  type PeriodicReport,
} from "./periodic_common";
import { errorMessage } from "../core/errors";

export interface MonthlyDigestExcerpt {
  month: string; // YYYY-MM
  content: string;
  tags: string[];
}

const MONTHLY_EXCERPT_CHARS = 4000;

/** Lists the Markdown files directly under a directory (none when it does not exist). */
function markdownFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Reads the monthly digests of a year. A digest is filed under the year it was generated in
 * (December's digest is written in January), so both `monthly/<year>/` and `monthly/<year+1>/`
 * are read and each digest is attributed by its `period` (or its "Monthly Digest YYYY-MM" title).
 * When a month has several digests, the last generated one wins.
 */
export function readMonthlyDigests(
  year: string,
  monthlyRoot: string = PATHS.ARTIFACTS_MONTHLY.absolute,
): MonthlyDigestExcerpt[] {
  const byMonth = new Map<string, MonthlyDigestExcerpt>();
  const files = [
    ...markdownFiles(path.join(monthlyRoot, year)),
    ...markdownFiles(path.join(monthlyRoot, String(Number(year) + 1))),
  ].sort();
  for (const file of files) {
    const { frontmatter, body } = splitFrontmatter(fs.readFileSync(file, "utf8"));
    const period = typeof frontmatter["period"] === "string" ? frontmatter["period"] : undefined;
    const title = typeof frontmatter["title"] === "string" ? frontmatter["title"] : "";
    const month = period ?? title.match(/(\d{4}-\d{2})/)?.[1];
    if (!month || !month.startsWith(`${year}-`)) continue;
    const tags = Array.isArray(frontmatter["tags"])
      ? frontmatter["tags"].filter((t): t is string => typeof t === "string")
      : [];
    byMonth.set(month, { month, content: body.slice(0, MONTHLY_EXCERPT_CHARS), tags });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface DailyTopStory {
  date: string;
  topStory: string;
  tags: string[];
  articleCount: number;
}

/** The top story (frontmatter `top_story`) of each daily summary of a year. */
export function readDailyTopStories(year: string, dailyRoot: string = PATHS.ARTIFACTS_DAILY.absolute): DailyTopStory[] {
  const stories: DailyTopStory[] = [];
  for (let m = 1; m <= 12; m++) {
    const dir = path.join(dailyRoot, year, String(m).padStart(2, "0"));
    for (const file of markdownFiles(dir).sort()) {
      const date = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})_digital-trend_daily_summary\.md$/)?.[1];
      if (!date) continue;
      const summary = readDailySummary(file, date, 0);
      if (summary.topStory) {
        stories.push({ date, topStory: summary.topStory, tags: summary.tags, articleCount: summary.articleCount });
      }
    }
  }
  return stories;
}

/**
 * Generates the yearly report. Resolves with null when the year has neither monthly digests nor
 * daily summaries; throws when generation fails.
 * @param year Format: "2026"
 */
export async function generateYearlyReport(year: string): Promise<PeriodicReport | null> {
  if (!/^\d{4}$/.test(year)) {
    throw new Error(`Invalid year "${year}": use "YYYY"`);
  }

  const monthly = readMonthlyDigests(year);
  const topStories = readDailyTopStories(year);
  if (monthly.length === 0 && topStories.length === 0) {
    console.log(`ℹ️ No monthly digests or daily summaries found for ${year}. Skipping yearly report.`);
    return null;
  }

  console.log(
    `📅 Generating yearly report for ${year} (${monthly.length} monthly digests, ${topStories.length} daily top stories)`,
  );

  const userPrompt = `Year: ${year}
Monthly digests: ${monthly.length} (${monthly.map((m) => m.month).join(", ") || "none"})
Daily summaries with a top story: ${topStories.length}

Monthly digest excerpts:

${JSON.stringify(
  monthly.map((m) => ({ month: m.month, content_excerpt: m.content })),
  null,
  2,
)}

Top story of each daily summary:

${topStories.map((s) => `- ${s.date}: ${s.topStory}`).join("\n")}

Generate the yearly trend report.`;

  const language = outputLanguage();
  let reportText: string;
  try {
    const response = await llmCall({
      systemPrompt: getYearlyReducePrompt(language),
      userPrompt,
      phase: "reduce",
      maxOutputTokens: 16384,
    });
    reportText = response.text;
  } catch (error) {
    throw new Error(`Yearly report generation failed for ${year}: ${errorMessage(error)}`, { cause: error });
  }

  const endDate = `${year}-12-31`;
  // Second half of the year against the first
  const markdown = appendTrendSection(reportText, endDate, 365, language);
  const tags = rankByFrequency([...monthly.flatMap((m) => m.tags), ...topStories.flatMap((s) => s.tags)], 10);
  const title = `Yearly Trend Report ${year}`;
  // Articles summarized over the year, like the article count of the weekly and monthly reports
  const totalArticles = topStories.reduce((sum, s) => sum + s.articleCount, 0);

  const outputPath = saveMarkdownFile(
    path.join(PATHS.ARTIFACTS_YEARLY.absolute, year),
    `${year}_digital-trend_yearly_report.md`,
    title,
    markdown,
    totalArticles,
    config.settings.author,
    {
      tags,
      sources: [`${monthly.length} monthly digests`, `${topStories.length} daily summaries`],
      type: "yearly_report",
      period: year,
      language,
      prompts: metrics.getSnapshot().prompts,
    },
  );

  console.log(`✅ Yearly report generated: ${outputPath}`);
  return {
    kind: "yearly",
    period: year,
    endDate,
    title,
    markdown,
    articleCount: totalArticles,
    tags,
    language,
    outputPath,
  };
}
