/**
 * [Role] Temporal trend detection across daily summaries.
 * [Mechanism] Analyzes historical daily summaries to detect recurring topics,
 * track topic evolution over time, and identify emerging trends.
 *
 * Item: 8.1 時系列トレンド検出
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";
import { llmCall } from "../summarization/llm_gateway";

interface TopicOccurrence {
  topic: string;
  dates: string[];
  totalMentions: number;
  trend: "rising" | "stable" | "declining" | "new";
}

/**
 * Scans daily summaries to extract topic frequencies over time.
 */
export function analyzeTopicTrends(
  daysBack: number = 30
): TopicOccurrence[] {
  const dailyDir = PATHS.ARTIFACTS_DAILY.absolute;
  if (!fs.existsSync(dailyDir)) return [];

  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const filesToProcess: string[] = [];
  
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const yyyy = d.getFullYear().toString();
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const filePath = path.join(dailyDir, yyyy, mm, `${dateStr}_digital-trend_daily_summary.md`);
    
    if (fs.existsSync(filePath)) {
      filesToProcess.push(filePath);
    }
  }

  const topicDates = new Map<string, string[]>();

  for (const filePath of filesToProcess) {
    const file = path.basename(filePath);
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch?.[1]) continue;

    try {
      const content = fs.readFileSync(filePath, "utf8");

      // Extract tags from frontmatter
      const tagsMatch = content.match(/^tags:\s*\n((?:\s+-\s+.+\n)*)/m);
      if (tagsMatch?.[1]) {
        const tags = tagsMatch[1].match(/- (.+)/g)?.map((t) => t.replace("- ", "").trim()) ?? [];
        for (const tag of tags) {
          const existing = topicDates.get(tag) ?? [];
          existing.push(dateMatch[1]);
          topicDates.set(tag, existing);
        }
      }

      // Also check for key technology terms in the body
      const bodyStart = content.indexOf("---\n\n");
      const body = bodyStart >= 0 ? content.slice(bodyStart + 5) : "";
      extractTopicsFromBody(body, dateMatch[1], topicDates);
    } catch {
      // Skip unreadable files
    }
  }

  // Analyze trends
  const halfwayDate = new Date(Date.now() - (daysBack / 2) * 24 * 60 * 60 * 1000);
  const results: TopicOccurrence[] = [];

  for (const [topic, dates] of topicDates) {
    if (dates.length < 2) continue; // Too few occurrences

    const recentCount = dates.filter((d) => new Date(d) >= halfwayDate).length;
    const olderCount = dates.length - recentCount;

    let trend: TopicOccurrence["trend"];
    if (olderCount === 0) trend = "new";
    else if (recentCount > olderCount * 1.5) trend = "rising";
    else if (recentCount < olderCount * 0.5) trend = "declining";
    else trend = "stable";

    results.push({
      topic,
      dates,
      totalMentions: dates.length,
      trend,
    });
  }

  return results
    .sort((a, b) => b.totalMentions - a.totalMentions)
    .slice(0, 50);
}

const TRACKED_TERMS = [
  "OpenAI", "Google", "Anthropic", "Meta", "NVIDIA",
  "GPT", "Claude", "Gemini", "LLaMA", "Mistral",
  "AI Agent", "RAG", "fine-tuning", "RLHF",
  "transformer", "multi-modal", "regulation",
];

function extractTopicsFromBody(
  body: string,
  date: string,
  topicDates: Map<string, string[]>
): void {
  for (const term of TRACKED_TERMS) {
    if (body.toLowerCase().includes(term.toLowerCase())) {
      const existing = topicDates.get(term) ?? [];
      if (!existing.includes(date)) {
        existing.push(date);
        topicDates.set(term, existing);
      }
    }
  }
}

/**
 * Generates a trend analysis section for monthly/weekly digests.
 */
export function formatTrendAnalysis(trends: TopicOccurrence[]): string {
  const rising = trends.filter((t) => t.trend === "rising");
  const newTopics = trends.filter((t) => t.trend === "new");
  const declining = trends.filter((t) => t.trend === "declining");

  const parts: string[] = [];

  if (rising.length > 0) {
    parts.push("### 📈 上昇トレンド");
    for (const t of rising.slice(0, 10)) {
      parts.push(`- **${t.topic}**: ${t.totalMentions}回言及 (直近で加速)`);
    }
  }

  if (newTopics.length > 0) {
    parts.push("\n### 🆕 新規トピック");
    for (const t of newTopics.slice(0, 10)) {
      parts.push(`- **${t.topic}**: ${t.totalMentions}回 (新出)`);
    }
  }

  if (declining.length > 0) {
    parts.push("\n### 📉 下降トレンド");
    for (const t of declining.slice(0, 5)) {
      parts.push(`- **${t.topic}**: ${t.totalMentions}回 (減少傾向)`);
    }
  }

  return parts.join("\n");
}
