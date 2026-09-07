/**
 * [Role] Keyword auto-expansion analysis.
 * [Mechanism] Analyzes recently processed articles to discover frequently
 * occurring terms that are not currently in the keyword lists, then
 * suggests additions.
 *
 * Item: 3.2 Keyword Auto-Expansion
 */

import { config } from "../core/config";

interface KeywordSuggestion {
  word: string;
  frequency: number;
  suggestedPurpose: string;
  suggestedWeight: number;
}

// Stopwords to exclude from suggestions (common words with no scoring value)
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "with", "from", "that",
  "this", "these", "those", "they", "them", "their", "there", "here",
  "where", "when", "what", "which", "who", "whom", "how", "and", "but",
  "or", "nor", "not", "no", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "than", "too", "very",
  "also", "just", "about", "above", "after", "again", "for", "new",
  "own", "same", "into", "over", "only", "out", "its", "top",
  // Japanese stopwords
  "の", "に", "は", "を", "た", "が", "で", "て", "と", "し", "れ", "さ",
  "ある", "いる", "する", "こと", "それ", "これ", "その", "この", "よう",
  "なる", "から", "まで", "など", "また", "ない",
]);

/**
 * Extracts candidate keywords from article titles that are NOT currently
 * in any purpose's keyword list.
 */
export function discoverCandidateKeywords(
  articleTitles: string[]
): KeywordSuggestion[] {
  // Collect all existing keywords across all purposes
  const existingKeywords = new Set<string>();
  for (const [, purpose] of Object.entries(config.purposes)) {
    if (!purpose.scoring) continue;
    for (const kw of purpose.scoring.keywords) {
      existingKeywords.add(kw.word.toLowerCase());
    }
  }

  // Count word frequencies across all titles
  const wordFreq = new Map<string, number>();
  for (const title of articleTitles) {
    const words = title
      .replace(/[^\w\s\u3000-\u9FFF]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    const uniqueWords = new Set(words);
    for (const word of uniqueWords) {
      if (STOPWORDS.has(word.toLowerCase())) continue;
      if (existingKeywords.has(word.toLowerCase())) continue;
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }
  }

  // Filter to words appearing in 3+ titles (significant frequency)
  const minFrequency = Math.max(3, Math.floor(articleTitles.length * 0.05));
  const suggestions: KeywordSuggestion[] = [];

  for (const [word, freq] of wordFreq) {
    if (freq < minFrequency) continue;

    // Heuristic: suggest purpose and weight based on word characteristics
    const suggestedPurpose = guessPurpose(word);
    const suggestedWeight = Math.min(10, Math.round(freq / 2));

    suggestions.push({
      word,
      frequency: freq,
      suggestedPurpose,
      suggestedWeight,
    });
  }

  // Sort by frequency descending
  suggestions.sort((a, b) => b.frequency - a.frequency);
  return suggestions.slice(0, 20); // Top 20 suggestions
}

function guessPurpose(word: string): string {
  const lw = word.toLowerCase();
  if (/model|train|neural|bert|llama|mistral|embedding|vector/.test(lw)) return "ai_research";
  if (/code|dev|api|sdk|tool|ide|plugin|extension|vscode/.test(lw)) return "ai_dev_tools";
  if (/ceo|revenue|funding|market|billion|startup|ipo|acquire/.test(lw)) return "business";
  if (/regulation|policy|government|law|sanction|eu|congress/.test(lw)) return "geopolitics";
  return "ai_dev_tools"; // Default
}

/**
 * Formats keyword suggestions as a human-readable report.
 */
export function formatSuggestionReport(suggestions: KeywordSuggestion[]): string {
  if (suggestions.length === 0) return "No new keyword suggestions this period.";

  const rows = suggestions.map(
    (s) => `| ${s.word} | ${s.frequency} | ${s.suggestedPurpose} | ${s.suggestedWeight} |`
  );

  return `## 🔑 Keyword Expansion Suggestions

| Word | Frequency | Suggested Purpose | Suggested Weight |
|:---|:---:|:---|:---:|
${rows.join("\n")}

> These terms appeared frequently in recent articles but are not in any keyword list.
> Review and add relevant terms to \`config.yml\`.`;
}
