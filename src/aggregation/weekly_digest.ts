/**
 * [Role] Weekly digest generation from daily summaries.
 * [Mechanism] Reads daily summary Markdown files for a given week (e.g. "2026-W38" or date range),
 * extracts facts and metadata, then uses Reduce phase to generate
 * a weekly trend analysis report.
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";
import { llmCall } from "../summarization/llm_gateway";
import { getWeeklyReducePrompt } from "../summarization/prompts";
import { saveMarkdownFile, SummaryFrontmatter } from "../storage/markdown_builder";
import { config } from "../core/config";

interface DailySummaryMeta {
  date: string;
  title: string;
  content: string;
  articleCount: number;
  categories: string[];
}

/**
 * Calculates the ISO week string (e.g. "2026-W38") for a given Date.
 */
export function getIsoWeekString(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
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

/**
 * Generates a weekly digest by aggregating daily summaries.
 * @param weekParam Format: "2026-W38" or a date "2026-09-20"
 */
export async function generateWeeklyDigest(weekParam: string): Promise<string | null> {
  let isoWeek = weekParam;
  let startDate: string;
  let endDate: string;

  if (weekParam.includes("-W")) {
    isoWeek = weekParam;
    const dates = getDatesForIsoWeek(isoWeek);
    startDate = dates.startDate;
    endDate = dates.endDate;
  } else {
    // Treat as single date within target week
    const targetDate = new Date(weekParam);
    isoWeek = getIsoWeekString(targetDate);
    const dates = getDatesForIsoWeek(isoWeek);
    startDate = dates.startDate;
    endDate = dates.endDate;
  }

  const year = isoWeek.split("-")[0] as string;

  // Search across daily summary directories
  const dailyRoot = PATHS.ARTIFACTS_DAILY.absolute;
  if (!fs.existsSync(dailyRoot)) {
    console.warn(`⚠️ Daily artifacts directory not found: ${dailyRoot}`);
    return null;
  }

  const allDailyFiles: string[] = [];
  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          allDailyFiles.push(full);
        }
      }
    } catch {
      // ignore
    }
  }
  walk(dailyRoot);

  // Filter files within the week's date range [startDate, endDate]
  const matchedSummaries: DailySummaryMeta[] = [];
  for (const filePath of allDailyFiles) {
    const filename = path.basename(filePath);
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch || !dateMatch[1]) continue;

    const fileDate = dateMatch[1];
    if (fileDate >= startDate && fileDate <= endDate) {
      const content = fs.readFileSync(filePath, "utf8");
      const titleMatch = content.match(/^title:\s*(.+)$/m);
      const countMatch = content.match(/^articles_processed:\s*(\d+)$/m);
      const catMatch = content.match(/^categories:\s*\n((?:\s+-\s+.+\n)*)/m);

      const bodyStart = content.indexOf("---\n\n");
      const body = bodyStart >= 0 ? content.slice(bodyStart + 5) : content;

      matchedSummaries.push({
        date: fileDate,
        title: titleMatch?.[1]?.replace(/["']/g, "") ?? `Summary ${fileDate}`,
        content: body.slice(0, 3000),
        articleCount: parseInt(countMatch?.[1] ?? "0", 10),
        categories: catMatch?.[1]?.match(/- (.+)/g)?.map((l) => l.replace("- ", "")) ?? [],
      });
    }
  }

  if (matchedSummaries.length === 0) {
    console.log(`ℹ️ No daily summaries found for week ${isoWeek} (${startDate} ~ ${endDate}). Skipping weekly digest.`);
    return null;
  }

  matchedSummaries.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`📅 Generating weekly digest for ${isoWeek} (${matchedSummaries.length} daily summaries, ${startDate} ~ ${endDate})`);

  const totalArticles = matchedSummaries.reduce((sum, d) => sum + d.articleCount, 0);
  const allCategories = [...new Set(matchedSummaries.flatMap((d) => d.categories))];

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

  try {
    const response = await llmCall({
      systemPrompt: getWeeklyReducePrompt(),
      userPrompt,
      phase: "reduce",
      maxOutputTokens: 16384,
    });

    const filename = `${endDate}_digital-trend_weekly_report.md`;
    const title = `Weekly Trend Report ${isoWeek} (${startDate} ~ ${endDate})`;

    const frontmatter: SummaryFrontmatter = {
      tags: allCategories.slice(0, 10),
      categories: allCategories,
      sources: [`${matchedSummaries.length} daily summaries (${startDate} ~ ${endDate})`],
    };

    const outputDir = path.join(PATHS.ARTIFACTS_WEEKLY.absolute, year);
    const outputPath = saveMarkdownFile(
      outputDir,
      filename,
      title,
      response.text,
      totalArticles,
      config.settings.author,
      {
        ...frontmatter,
        type: "weekly_report",
        period: isoWeek,
      } as any,
    );

    console.log(`✅ Weekly digest generated: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.error(`❌ Weekly digest generation failed: ${error.message}`);
    return null;
  }
}
