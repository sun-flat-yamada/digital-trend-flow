import type { ArticleItem } from "./types";

const SOURCE_LABELS: Record<string, string> = {
  hackernews: "Hacker News",
  reddit: "Reddit",
  bluesky: "Bluesky",
  github_trending: "GitHub",
};

/**
 * Describes an article's engagement signals and author in one line (e.g. "Hacker News: 1637 points"),
 * for prompts that benefit from them. Undefined when the source reported none.
 */
export function describeEngagement(
  item: Pick<ArticleItem, "sourceType" | "engagement" | "author">,
): string | undefined {
  const label = SOURCE_LABELS[item.sourceType] ?? item.sourceType;
  const { score, likes, starsToday } = item.engagement ?? {};
  const parts: string[] = [];
  if (score !== undefined) parts.push(`${label}: ${score} ${item.sourceType === "reddit" ? "upvotes" : "points"}`);
  if (likes !== undefined) parts.push(`${label}: ${likes} likes`);
  if (starsToday !== undefined) parts.push(`${label}: ${starsToday} stars today`);
  if (item.author) parts.push(`Channel: ${item.author}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}
