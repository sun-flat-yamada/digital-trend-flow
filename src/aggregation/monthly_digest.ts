/**
 * [Role] Monthly digest generation from daily summaries.
 * [Mechanism] Reads daily summary Markdown files for a given month,
 * extracts facts and metadata, then uses Reduce phase to generate
 * a monthly trend analysis.
 *
 * Item: 6.1 月次ダイジェスト実装
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";
import { llmCall } from "../summarization/llm_gateway";
import { getMonthlyReducePrompt } from "../summarization/prompts";
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
 * Generates a monthly digest by aggregating daily summaries.
 * @param yearMonth Format: "2026-04"
 */
export async function generateMonthlyDigest(yearMonth: string): Promise<string | null> {
  const [year, month] = yearMonth.split("-") as [string, string];
  const dailyDir = path.join(PATHS.ARTIFACTS_DAILY.absolute, year, month);
  if (!fs.existsSync(dailyDir)) {
    console.warn(`⚠️ No daily summaries found for monthly digest at ${dailyDir}.`);
    return null;
  }

  // Find all daily summaries for the given month
  const dailyFiles = fs.readdirSync(dailyDir)
    .filter((f) => f.startsWith(yearMonth) && f.endsWith("_digital-trend_daily_summary.md"))
    .sort();

  if (dailyFiles.length === 0) {
    console.log(`ℹ️ No daily summaries found for ${yearMonth}. Skipping monthly digest.`);
    return null;
  }

  console.log(`📅 Generating monthly digest for ${yearMonth} (${dailyFiles.length} daily summaries)`);

  // Extract content from each daily summary
  const dailySummaries: DailySummaryMeta[] = [];
  for (const file of dailyFiles) {
    const content = fs.readFileSync(path.join(dailyDir, file), "utf8");
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const countMatch = content.match(/^articles_processed:\s*(\d+)$/m);
    const catMatch = content.match(/^categories:\s*\n((?:\s+-\s+.+\n)*)/m);

    // Extract body (after frontmatter)
    const bodyStart = content.indexOf("---\n\n");
    const body = bodyStart >= 0 ? content.slice(bodyStart + 5) : content;

    dailySummaries.push({
      date: dateMatch?.[1] ?? "",
      title: titleMatch?.[1]?.replace(/["']/g, "") ?? "",
      content: body.slice(0, 3000), // Truncate per-day to fit context
      articleCount: parseInt(countMatch?.[1] ?? "0", 10),
      categories: catMatch?.[1]?.match(/- (.+)/g)?.map((l) => l.replace("- ", "")) ?? [],
    });
  }

  // Build the reduce input
  const totalArticles = dailySummaries.reduce((sum, d) => sum + d.articleCount, 0);
  const allCategories = [...new Set(dailySummaries.flatMap((d) => d.categories))];

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

  try {
    const response = await llmCall({
      systemPrompt: getMonthlyReducePrompt(),
      userPrompt,
      phase: "reduce",
      maxOutputTokens: 16384,
    });

    // Save monthly digest
    // Save monthly digest
    const today = new Date().toISOString().split("T")[0] ?? yearMonth + "-01";
    const filename = `${today}_digital-trend_monthly_report.md`;
    const title = `Monthly Digest ${yearMonth}`;

    const frontmatter: SummaryFrontmatter = {
      tags: allCategories.slice(0, 10),
      categories: allCategories,
      sources: [`${dailyFiles.length} daily summaries`],
    };

    const outputDir = path.join(PATHS.ARTIFACTS_MONTHLY.absolute, year);
    const outputPath = saveMarkdownFile(
      outputDir,
      filename,
      title,
      response.text,
      totalArticles,
      config.settings.author,
      frontmatter
    );

    console.log(`✅ Monthly digest generated: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.error(`❌ Monthly digest generation failed: ${error.message}`);
    return null;
  }
}
