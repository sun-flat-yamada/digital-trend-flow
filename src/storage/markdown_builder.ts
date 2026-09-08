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

  // Obsidian navigation links
  let footer = "";
  if (metadata?.previousDate) {
    const isEn = metadata.language?.toLowerCase() === "en" || metadata.language?.toLowerCase() === "english";
    const prevText = isEn ? "Previous Summary" : "前日のサマリー";
    footer = `\n\n---\n\n← [[${metadata.previousDate}_summary|${prevText}]]`;
  }

  const fullContent = frontmatter + content + footer;
  const filePath = path.join(absoluteDir, filename);

  fs.writeFileSync(filePath, fullContent, "utf8");
  console.log(`✅ Summary saved to: ${filePath}`);
  return filePath;
}
