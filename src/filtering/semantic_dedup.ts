/**
 * [Role] Semantic deduplication using title similarity.
 * [Mechanism] Uses a lightweight string-similarity approach (Jaccard on
 * word trigrams) to detect near-duplicate articles without external API calls.
 * When Gemini embedding API is available, can upgrade to vector cosine similarity.
 *
 * Item: 2.4 Semantic Deduplication
 */

import { config } from "../core/config";

interface DeduplicationCandidate {
  url: string;
  title: string;
  score: number;
  purpose: string;
}

// ── Ngram-based Similarity (Multilingual & CJK aware) ──

/**
 * Strips editorial tags and brackets commonly found in news titles.
 */
function cleanHeadline(text: string): string {
  return text
    .replace(/^(\[[^\]]+\]|【[^】]+】|\([^)]+\))\s*/g, "")
    .trim();
}

/**
 * Generates character n-grams from text, supporting both Latin and CJK scripts.
 * Uses 2-grams for CJK text (where words are short and lack spaces) and
 * 3-grams for Latin/alphanumeric text.
 */
function generateTrigrams(text: string): Set<string> {
  const cleaned = cleanHeadline(text);
  // Preserve Unicode letters and numbers across all languages
  const normalized = cleaned
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  const ngrams = new Set<string>();
  if (normalized.length === 0) return ngrams;

  const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);

  if (hasCjk) {
    // For CJK, character bi-grams on string without spaces capture 2-kanji compounds and phrases
    const compact = normalized.replace(/\s+/g, "");
    for (let i = 0; i <= compact.length - 2; i++) {
      ngrams.add(compact.slice(i, i + 2));
    }
  } else {
    // For Latin, 3-grams as originally designed
    for (let i = 0; i <= normalized.length - 3; i++) {
      ngrams.add(normalized.slice(i, i + 3));
    }
  }

  return ngrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicates articles by title similarity.
 * When two articles exceed the similarity threshold, the one with the higher
 * score is kept. This catches cases where the same news appears under
 * different URLs from different sources.
 *
 * @param articles Array of candidate articles with scores
 * @returns Deduplicated array (duplicates removed, higher-scored kept)
 */
export function semanticDedup<T extends DeduplicationCandidate>(
  articles: T[]
): T[] {
  if (!config.settings.semantic_dedup.enabled) return articles;

  const threshold = config.settings.semantic_dedup.similarity_threshold;
  const kept: T[] = [];
  const keptTrigrams: Array<{ trigrams: Set<string>; index: number }> = [];
  let removedCount = 0;

  // Sort by score descending so we keep the higher-scored version
  const sorted = [...articles].sort((a, b) => b.score - a.score);

  for (const article of sorted) {
    const trigrams = generateTrigrams(article.title);
    let isDuplicate = false;

    for (const existing of keptTrigrams) {
      const similarity = jaccardSimilarity(trigrams, existing.trigrams);
      if (similarity >= threshold) {
        isDuplicate = true;
        removedCount++;
        console.log(
          `  🔄 Dedup: "${article.title}" ≈ "${kept[existing.index]?.title}" (sim: ${(similarity * 100).toFixed(0)}%)`
        );
        break;
      }
    }

    if (!isDuplicate) {
      keptTrigrams.push({ trigrams, index: kept.length });
      kept.push(article);
    }
  }

  if (removedCount > 0) {
    console.log(`  🔄 Semantic dedup removed ${removedCount} near-duplicate(s).`);
  }

  return kept;
}
