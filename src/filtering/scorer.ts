/**
 * [Role] Filters and scores articles based on domain, length, keywords, and relevance.
 * [Mechanism] Implements rule-based exclusion, multi-purpose weighted scoring,
 * LLM-as-a-Judge evaluation, freshness scoring, and TF-IDF dynamic weighting.
 *
 * Items: 3.1 LLM-as-Judge, 3.3 TF-IDF, 3.4 Negative keyword refinement, 2.5 Freshness
 */

import { config } from "../core/config";
import { ExcludeRules, PurposeScoring, ExcludeKeyword } from "../core/types";
import { llmCall } from "../summarization/llm_gateway";
import { getJudgePrompt, JUDGE_RESPONSE_SCHEMA } from "../summarization/prompts";

export interface ArticleData {
  url: string;
  title: string;
  content: string; // Markdown body extracted by Jina etc.
  publishedAt?: string; // ISO 8601 timestamp for freshness scoring
  language?: string; // Item 2.6
}

export interface PurposeScoreOutput {
  isExcluded: boolean;
  exclusionReason?: string;
  assignedPurpose: string;   // Final purpose (may differ from source purpose for curated)
  purposeLabel: string;      // Human-readable label
  totalScore: number;
  matchedKeywords: string[];
  llmJudgeScore?: number;    // Item 3.1
  freshnessFactor?: number;  // Item 2.5
  detectedTopics?: string[]; // Item 3.1
}

// ── TF-IDF State (Item 3.3) ──
// Tracks document frequency of keywords across all articles processed in this run.
// Used to dynamically adjust keyword weights (common words get reduced weight).

const documentFrequency = new Map<string, number>();
let totalDocuments = 0;

export function updateDocumentFrequency(matchedKeywords: string[]): void {
  totalDocuments++;
  const unique = new Set(matchedKeywords);
  for (const kw of unique) {
    documentFrequency.set(kw, (documentFrequency.get(kw) ?? 0) + 1);
  }
}

function getTfIdfMultiplier(keyword: string): number {
  if (totalDocuments < 5) return 1.0; // Not enough data for meaningful IDF
  const df = documentFrequency.get(keyword) ?? 0;
  if (df === 0) return 1.0;
  // IDF: log(N / df) — words appearing in more documents get lower weight
  const idf = Math.log(totalDocuments / df);
  // Normalize to 0.3–1.5 range to prevent extreme swings
  return Math.max(0.3, Math.min(1.5, idf));
}

// ── URL Normalization ──

/**
 * Sanitizes URLs for consistent deduplication by stripping tracking parameters.
 */
export function normalizeUrl(rawUrl: string, excludeRules: ExcludeRules = config.exclude): string {
  try {
    const urlObj = new URL(rawUrl);
    excludeRules.url_strip_parameters.forEach((param) => {
      urlObj.searchParams.delete(param);
    });
    return urlObj.toString();
  } catch (e) {
    return rawUrl;
  }
}

// ── Exclude Keyword Matching (Item 3.4: Enhanced) ──

/**
 * Checks if a text matches an exclude keyword with scope awareness.
 */
function matchesExcludeKeyword(
  keyword: ExcludeKeyword,
  title: string,
  content: string,
  checkScope: "title" | "content" | "both"
): boolean {
  // Legacy string format — check in the specified scope
  if (typeof keyword === "string") {
    if (checkScope === "title" || checkScope === "both") {
      if (title.includes(keyword)) return true;
    }
    if (checkScope === "content" || checkScope === "both") {
      if (content.includes(keyword)) return true;
    }
    return false;
  }

  // Enhanced object format with scope and regex support
  const effectiveScope = keyword.scope ?? "both";
  const textToCheck: string[] = [];

  if ((effectiveScope === "title" || effectiveScope === "both") &&
      (checkScope === "title" || checkScope === "both")) {
    textToCheck.push(title);
  }
  if ((effectiveScope === "content" || effectiveScope === "both") &&
      (checkScope === "content" || checkScope === "both")) {
    textToCheck.push(content);
  }

  for (const text of textToCheck) {
    if (keyword.is_regex) {
      try {
        if (new RegExp(keyword.pattern, "i").test(text)) return true;
      } catch {
        // Invalid regex — fallback to includes
        if (text.includes(keyword.pattern)) return true;
      }
    } else {
      if (text.includes(keyword.pattern)) return true;
    }
  }

  return false;
}

// ── Metadata Pre-Filter ──

/**
 * Evaluates URL and title against the global blocklist (early return filter).
 */
export function excludeByMetadata(title: string, url: string, excludeRules: ExcludeRules = config.exclude): { excluded: boolean; reason?: string } {
  // 1. Check Domain
  try {
    const hostname = new URL(url).hostname;
    if (excludeRules.domains.some((d) => hostname.includes(d))) {
      return { excluded: true, reason: `Domain blocked: ${hostname}` };
    }
  } catch (e) {
    // If URL is invalid, let it pass domain check
  }

  // 2. Check NG Keywords in Title (Item 3.4)
  for (const keyword of excludeRules.keywords) {
    if (matchesExcludeKeyword(keyword, title, "", "title")) {
      const pattern = typeof keyword === "string" ? keyword : keyword.pattern;
      return { excluded: true, reason: `NG Keyword match in title: "${pattern}"` };
    }
  }

  return { excluded: false };
}

/**
 * Full exclusion check including content length and content NG keywords.
 */
export function classifyExclusion(article: ArticleData, excludeRules: ExcludeRules = config.exclude): { excluded: boolean; reason?: string } {
  // 1. Check Metadata first
  const metadataCheck = excludeByMetadata(article.title, article.url, excludeRules);
  if (metadataCheck.excluded) return metadataCheck;

  // 2. Check Content Length
  const length = article.content.length;
  if (length < excludeRules.content_length.min) {
    return { excluded: true, reason: `Content too short (${length} chars < ${excludeRules.content_length.min})` };
  }
  if (length > excludeRules.content_length.max) {
    return { excluded: true, reason: `Content too long (${length} chars > ${excludeRules.content_length.max})` };
  }

  // 3. Check NG Keywords in Content (Item 3.4)
  for (const keyword of excludeRules.keywords) {
    if (matchesExcludeKeyword(keyword, "", article.content, "content")) {
      const pattern = typeof keyword === "string" ? keyword : keyword.pattern;
      return { excluded: true, reason: `NG Keyword match in content: "${pattern}"` };
    }
  }

  return { excluded: false };
}

/**
 * Cleanses Markdown text to reduce token usage.
 */
export function cleanseMarkdownContext(markdown: string): string {
  if (!markdown) return "";
  
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "[$1]")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

/**
 * Matches a keyword against text using appropriate strategy.
 */
function matchesKeyword(text: string, keyword: string): boolean {
  const hasSpace = keyword.includes(" ");
  const hasNonAscii = /[^\x00-\x7F]/.test(keyword);

  if (hasSpace || hasNonAscii) {
    return text.toLowerCase().includes(keyword.toLowerCase());
  }

  try {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  } catch {
    return text.toLowerCase().includes(keyword.toLowerCase());
  }
}

// ── Freshness Scoring (Item 2.5) ──

/**
 * Calculates a freshness factor based on article age.
 * Uses exponential decay: e^(-λ * hours_since_published)
 */
export function calculateFreshnessFactor(publishedAt?: string): number {
  if (!config.settings.freshness.enabled || !publishedAt) return 1.0;

  try {
    const published = new Date(publishedAt);
    const now = new Date();
    const hoursSince = (now.getTime() - published.getTime()) / (1000 * 60 * 60);

    if (hoursSince < 0) return 1.0; // Future date? Treat as fresh.
    if (hoursSince > config.settings.freshness.max_age_hours) return 0.3; // Very old

    const lambda = config.settings.freshness.decay_lambda;
    return Math.exp(-lambda * hoursSince);
  } catch {
    return 1.0;
  }
}

// ── Core Scoring Engine ──

function scoreAgainstPurpose(
  article: ArticleData,
  scoring: PurposeScoring
): { score: number; matchedKeywords: string[] } {
  let score = 0;
  const matchedKeywords: string[] = [];
  const multiplier = scoring.title_multiplier || 1.0;

  for (const kwData of scoring.keywords) {
    // Item 3.3: Apply TF-IDF multiplier to keyword weight
    const tfidfMultiplier = getTfIdfMultiplier(kwData.word);
    const effectiveWeight = kwData.weight * tfidfMultiplier;

    // Check title (gets multiplier)
    if (matchesKeyword(article.title, kwData.word)) {
      score += effectiveWeight * multiplier;
      if (!matchedKeywords.includes(kwData.word)) matchedKeywords.push(kwData.word);
    }

    // Check content
    if (matchesKeyword(article.content, kwData.word)) {
      score += effectiveWeight;
      if (!matchedKeywords.includes(kwData.word)) matchedKeywords.push(kwData.word);
    }
  }

  return { score, matchedKeywords };
}

// ── LLM-as-a-Judge (Item 3.1) ──

interface JudgeResult {
  relevance_score: number;
  category_suggestion: string;
  reasoning: string;
  is_breaking_news: boolean;
  topics: string[];
}

/**
 * Uses an LLM to evaluate article relevance (Item 3.1).
 * Returns null if judging is disabled or fails.
 */
export async function llmJudgeScore(
  article: ArticleData,
  availableCategories: string[]
): Promise<JudgeResult | null> {
  if (!config.settings.llm_judge.enabled) return null;

  try {
    const excerpt = article.content.slice(0, 500);
    const userPrompt = `Available Categories: ${availableCategories.join(", ")}

Article Title: ${article.title}
Article Excerpt: ${excerpt}

Evaluate this article's relevance and importance.`;

    const response = await llmCall({
      systemPrompt: getJudgePrompt(),
      userPrompt,
      phase: "judge",
      responseSchema: JUDGE_RESPONSE_SCHEMA,
      temperature: 0.1,
    });

    const cleanedJson = response.text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    return JSON.parse(cleanedJson) as JudgeResult;
  } catch (error: any) {
    console.warn(`  ⚠️ LLM Judge failed for "${article.title}": ${error.message}`);
    return null;
  }
}

// ── Public Scoring Functions ──

/**
 * Calculates the score of an article using its designated purpose's keyword list,
 * with optional LLM-as-Judge and freshness adjustments.
 */
export function calculatePurposeScore(
  article: ArticleData,
  purposeKey: string
): PurposeScoreOutput {
  // 1. Exclusion check
  const { excluded, reason } = classifyExclusion(article);
  if (excluded) {
    return {
      isExcluded: true,
      exclusionReason: reason || "Unknown exclusion",
      assignedPurpose: purposeKey,
      purposeLabel: config.purposes[purposeKey]?.label ?? purposeKey,
      totalScore: 0,
      matchedKeywords: [],
    };
  }

  // 2. Get the purpose definition
  const purpose = config.purposes[purposeKey];
  if (!purpose || !purpose.scoring) {
    return {
      isExcluded: false,
      assignedPurpose: purposeKey,
      purposeLabel: purpose?.label ?? purposeKey,
      totalScore: 0,
      matchedKeywords: [],
    };
  }

  // 3. Score against this purpose's keywords
  const { score, matchedKeywords } = scoreAgainstPurpose(article, purpose.scoring);

  // 4. Apply freshness factor (Item 2.5)
  const freshnessFactor = calculateFreshnessFactor(article.publishedAt);
  const freshnessAdjustedScore = score * freshnessFactor;

  // 5. Update TF-IDF document frequency (Item 3.3)
  updateDocumentFrequency(matchedKeywords);

  return {
    isExcluded: false,
    assignedPurpose: purposeKey,
    purposeLabel: purpose.label,
    totalScore: Math.round(freshnessAdjustedScore * 100) / 100,
    matchedKeywords,
    freshnessFactor,
  };
}

/**
 * Scores the article against every defined purpose and selects the best match.
 */
export function assignBestPurpose(article: ArticleData): PurposeScoreOutput {
  const { excluded, reason } = classifyExclusion(article);
  if (excluded) {
    return {
      isExcluded: true,
      exclusionReason: reason || "Unknown exclusion",
      assignedPurpose: "curated",
      purposeLabel: config.purposes["curated"]?.label ?? "📌 手動キュレーション",
      totalScore: 0,
      matchedKeywords: [],
    };
  }

  let bestPurpose = "curated";
  let bestScore = 0;
  let bestKeywords: string[] = [];
  let bestLabel = config.purposes["curated"]?.label ?? "📌 手動キュレーション";

  for (const [key, purpose] of Object.entries(config.purposes)) {
    if (key === "curated" || !purpose.scoring) continue;

    const { score, matchedKeywords } = scoreAgainstPurpose(article, purpose.scoring);
    const freshnessFactor = calculateFreshnessFactor(article.publishedAt);
    const adjustedScore = score * freshnessFactor;

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestPurpose = key;
      bestKeywords = matchedKeywords;
      bestLabel = purpose.label;
    }
  }

  updateDocumentFrequency(bestKeywords);

  return {
    isExcluded: false,
    assignedPurpose: bestPurpose,
    purposeLabel: bestLabel,
    totalScore: Math.round(bestScore * 100) / 100,
    matchedKeywords: bestKeywords,
    freshnessFactor: calculateFreshnessFactor(article.publishedAt),
  };
}

/**
 * Combines keyword score with LLM-as-Judge score (Item 3.1).
 */
export function combineWithJudgeScore(
  keywordScore: number,
  judgeResult: JudgeResult | null
): number {
  if (!judgeResult || !config.settings.llm_judge.enabled) return keywordScore;

  const weight = config.settings.llm_judge.weight;
  // Normalize judge score (0-100) to same scale as keyword score
  const normalizedJudge = judgeResult.relevance_score / 5; // → 0-20 scale
  return keywordScore * (1 - weight) + normalizedJudge * weight;
}

/**
 * Title-only pre-screening to skip expensive content extraction.
 */
export function titlePassesPreScreen(title: string, purposeKey: string): boolean {
  if (purposeKey === "curated") return true;

  const purpose = config.purposes[purposeKey];
  if (!purpose?.scoring) return true;
  if (purpose.scoring.threshold < 8) return true;

  return purpose.scoring.keywords.some((kw) => matchesKeyword(title, kw.word));
}

// Legacy exports for backward compatibility
export type { PurposeScoreOutput as ScoreOutput };

export function calculateScore(article: ArticleData): PurposeScoreOutput {
  return assignBestPurpose(article);
}
