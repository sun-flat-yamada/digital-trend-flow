import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

/**
 * Metadata to enrich Obsidian frontmatter for better searchability,
 * graph linking, and navigation between daily summaries.
 *
 * Item 6.3: Enhanced with DataView-optimized fields.
 */
export interface SummaryFrontmatter {
  tags?: string[] | undefined;
  categories?: string[] | undefined;
  sources?: string[] | undefined;
  topStory?: string | undefined;
  previousDate?: string | undefined;
  // Item 6.3: DataView extensions
  articleCount?: number | undefined;
  topPurpose?: string | undefined;
  mentionedCompanies?: string[] | undefined;
  mentionedTechnologies?: string[] | undefined;
  estimatedCostUsd?: number | undefined;
  executionTimeSec?: number | undefined;
  totalTokens?: { input: number; output: number } | undefined;
  qualityScore?: number | undefined;
  relatedNotes?: string[] | undefined;
  language?: string | undefined;
}

/**
 * Generates a Markdown file with safely-serialized YAML Frontmatter and saves it to disk.
 */
export function saveMarkdownFile(
  outputDir: string,
  filename: string,
  title: string,
  content: string,
  articleCount: number,
  author: string,
  metadata?: SummaryFrontmatter
): string {
  const absoluteDir = path.resolve(process.cwd(), outputDir);
  fs.mkdirSync(absoluteDir, { recursive: true });

  const frontmatterObj: Record<string, unknown> = {
    title,
    date: new Date().toISOString(),
    type: "daily_summary",
    articles_processed: articleCount,
    author,
    generated_by: "digital-trend-flow",
  };

  if (metadata?.tags && metadata.tags.length > 0) {
    frontmatterObj["tags"] = metadata.tags;
  }
  if (metadata?.categories && metadata.categories.length > 0) {
    frontmatterObj["categories"] = metadata.categories;
  }
  if (metadata?.sources && metadata.sources.length > 0) {
    frontmatterObj["sources"] = metadata.sources;
  }
  if (metadata?.topStory) {
    frontmatterObj["top_story"] = metadata.topStory;
  }
  if (metadata?.previousDate) {
    frontmatterObj["previous"] = `${metadata.previousDate}_summary`;
  }
  // Item 6.3: DataView-optimized fields
  if (metadata?.articleCount !== undefined) {
    frontmatterObj["article_count"] = metadata.articleCount;
  }
  if (metadata?.topPurpose) {
    frontmatterObj["top_purpose"] = metadata.topPurpose;
  }
  if (metadata?.mentionedCompanies && metadata.mentionedCompanies.length > 0) {
    frontmatterObj["mentioned_companies"] = metadata.mentionedCompanies;
  }
  if (metadata?.mentionedTechnologies && metadata.mentionedTechnologies.length > 0) {
    frontmatterObj["mentioned_technologies"] = metadata.mentionedTechnologies;
  }
  if (metadata?.estimatedCostUsd !== undefined) {
    frontmatterObj["estimated_cost_usd"] = metadata.estimatedCostUsd;
  }
  if (metadata?.executionTimeSec !== undefined) {
    frontmatterObj["execution_time_sec"] = metadata.executionTimeSec;
  }
  if (metadata?.totalTokens !== undefined) {
    frontmatterObj["total_tokens"] = metadata.totalTokens;
  }
  if (metadata?.qualityScore !== undefined) {
    frontmatterObj["quality_score"] = metadata.qualityScore;
  }
  if (metadata?.relatedNotes && metadata.relatedNotes.length > 0) {
    frontmatterObj["related_notes"] = metadata.relatedNotes;
  }
  if (metadata?.language) {
    frontmatterObj["language"] = metadata.language;
  }

  const frontmatter = `---\n${yaml.stringify(frontmatterObj)}---\n\n`;

  // Execution metrics foldable block
  let metricsBlock = "";
  if (
    metadata?.executionTimeSec !== undefined ||
    metadata?.totalTokens !== undefined ||
    metadata?.estimatedCostUsd !== undefined
  ) {
    const isEn = metadata.language?.toLowerCase() === "en" || metadata.language?.toLowerCase() === "english";
    const timeSec = (metadata.executionTimeSec ?? 0).toFixed(1);
    const inTokens = (metadata.totalTokens?.input ?? 0).toLocaleString();
    const outTokens = (metadata.totalTokens?.output ?? 0).toLocaleString();
    const totalTokens = ((metadata.totalTokens?.input ?? 0) + (metadata.totalTokens?.output ?? 0)).toLocaleString();
    const costUsd = (metadata.estimatedCostUsd ?? 0).toFixed(4);
    const exchangeRate = parseFloat(process.env.USD_JPY_RATE || "155.0");
    const costJpy = ((metadata.estimatedCostUsd ?? 0) * exchangeRate).toFixed(2);

    if (isEn) {
      metricsBlock = `\n\n<details class="pipeline-metrics">\n<summary>📊 Execution Metrics (Time, Tokens, Cost)</summary>\n\n- **Execution Time**: ${timeSec}s\n- **Tokens Used**: Input ${inTokens} / Output ${outTokens} (Total: ${totalTokens})\n- **Estimated Cost**: $${costUsd} (approx. ¥${costJpy})\n</details>`;
    } else {
      metricsBlock = `\n\n<details class="pipeline-metrics">\n<summary>📊 記事生成メトリクス（所要時間・消費Token・コスト）</summary>\n\n- **所要時間**: ${timeSec}秒\n- **消費Token**: 入力 ${inTokens} / 出力 ${outTokens} (合計: ${totalTokens})\n- **コスト**: $${costUsd} (約 ¥${costJpy})\n</details>`;
    }
  }

  // Obsidian navigation links
  let footer = "";
  if (metadata?.previousDate) {
    const isEn = metadata.language?.toLowerCase() === "en" || metadata.language?.toLowerCase() === "english";
    const prevText = isEn ? "Previous Summary" : "前日のサマリー";
    footer = `\n\n---\n\n← [[${metadata.previousDate}_summary|${prevText}]]`;
  }

  const fullContent = frontmatter + content + metricsBlock + footer;
  const filePath = path.join(absoluteDir, filename);

  fs.writeFileSync(filePath, fullContent, "utf8");
  console.log(`✅ Summary saved to: ${filePath}`);
  return filePath;
}
