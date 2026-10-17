/**
 * [Role] Keyword auto-expansion analysis.
 * [Mechanism] Finds terms (single words and two-word phrases) that recur in the titles of
 * recently selected articles but are in no purpose's keyword list, and suggests a purpose and a
 * weight for each. With history from the state DB, a term must also be over-represented in the
 * recent window compared with the preceding background window, and appear on several distinct
 * days, so that one-off news words ("stabbing") and generic words ("day") are not suggested.
 * Rule-based only: no LLM call.
 *
 * Item: 3.2 Keyword Auto-Expansion
 */

import { config } from "../core/config";

export interface KeywordSuggestion {
  word: string;
  frequency: number;
  suggestedPurpose: string;
  suggestedWeight: number;
  /** Over-representation against the background window (1 = same rate); absent without history. */
  lift?: number;
}

/** A title with the purpose it was selected for and the day it was processed (YYYY-MM-DD). */
export interface TitleDocument {
  title: string;
  purpose?: string | null | undefined;
  date?: string | undefined;
}

export interface HistoryOptions {
  /** Minimum number of recent titles containing the term. */
  minDocumentFrequency?: number;
  /** Minimum number of distinct days (when the documents carry dates). */
  minDistinctDays?: number;
  /** Minimum over-representation against the background. */
  minLift?: number;
  limit?: number;
}

// Words with no scoring value: function words, news boilerplate, time and quantity words.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "they",
  "them",
  "their",
  "there",
  "here",
  "where",
  "when",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "no",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "also",
  "just",
  "about",
  "above",
  "after",
  "again",
  "for",
  "new",
  "own",
  "same",
  "into",
  "over",
  "only",
  "out",
  "its",
  "top",
  "you",
  "your",
  "our",
  "his",
  "her",
  "him",
  "she",
  "it's",
  "via",
  "per",
  "amid",
  "against",
  "under",
  "before",
  "between",
  "during",
  "without",
  "within",
  "through",
  "off",
  "onto",
  "why",
  "now",
  "get",
  "gets",
  "got",
  "make",
  "makes",
  "made",
  "take",
  "takes",
  "use",
  "uses",
  "using",
  "used",
  "say",
  "says",
  "said",
  "see",
  "sees",
  "go",
  "goes",
  "going",
  "come",
  "comes",
  "want",
  "wants",
  "need",
  "needs",
  "know",
  "look",
  "looks",
  "find",
  "finds",
  "give",
  "gives",
  "keep",
  "help",
  "helps",
  "show",
  "shows",
  "tell",
  "tells",
  "call",
  "calls",
  "set",
  "sets",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "today",
  "yesterday",
  "tomorrow",
  "time",
  "times",
  "first",
  "last",
  "next",
  "one",
  "two",
  "three",
  "many",
  "much",
  "people",
  "thing",
  "things",
  "way",
  "ways",
  "world",
  "report",
  "reports",
  "news",
  "update",
  "updates",
  "big",
  "best",
  "better",
  "good",
  "great",
  "really",
  "still",
  "even",
  "back",
  "like",
  "down",
  "here's",
  "what's",
  "don't",
  "can't",
  "won't",
  "vs",
  "via",
  "inc",
  "ltd",
  // Japanese stopwords
  "の",
  "に",
  "は",
  "を",
  "た",
  "が",
  "で",
  "て",
  "と",
  "し",
  "れ",
  "さ",
  "ある",
  "いる",
  "する",
  "こと",
  "それ",
  "これ",
  "その",
  "この",
  "よう",
  "なる",
  "から",
  "まで",
  "など",
  "また",
  "ない",
]);

/** Splits a title into candidate terms: words (3+ chars, not numeric, not stopwords) and two-word phrases. */
export function extractTerms(title: string): string[] {
  const words = title
    .replace(/[^\w\s　-鿿'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, "").trim())
    .filter((w) => w.length > 0);

  const isCandidate = (w: string) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w.toLowerCase());
  const terms = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (isCandidate(w)) terms.add(w);
    const next = words[i + 1];
    if (next !== undefined && isCandidate(w) && isCandidate(next)) terms.add(`${w} ${next}`);
  }
  return [...terms];
}

function existingKeywordSet(): Set<string> {
  const existing = new Set<string>();
  for (const [, purpose] of Object.entries(config.purposes)) {
    if (!purpose.scoring) continue;
    for (const kw of purpose.scoring.keywords) existing.add(kw.word.toLowerCase());
  }
  return existing;
}

/** Median keyword weight of a purpose (the suggested weight of a new keyword there). */
function medianWeight(purposeKey: string): number | undefined {
  const weights = (config.purposes[purposeKey]?.scoring?.keywords ?? []).map((k) => k.weight).sort((a, b) => a - b);
  if (weights.length === 0) return undefined;
  return weights[Math.floor(weights.length / 2)];
}

function guessPurpose(word: string): string {
  const lw = word.toLowerCase();
  if (/model|train|neural|bert|llama|mistral|embedding|vector/.test(lw)) return "ai_research";
  if (/code|dev|api|sdk|tool|ide|plugin|extension|vscode/.test(lw)) return "ai_dev_tools";
  if (/ceo|revenue|funding|market|billion|startup|ipo|acquire/.test(lw)) return "business";
  if (/regulation|policy|government|law|sanction|eu|congress/.test(lw)) return "geopolitics";
  return "ai_dev_tools"; // Default
}

interface TermStats {
  spelling: string;
  docs: number;
  days: Set<string>;
  purposes: Map<string, number>;
}

function countTerms(documents: readonly TitleDocument[], existing: Set<string>): Map<string, TermStats> {
  const stats = new Map<string, TermStats>();
  for (const doc of documents) {
    for (const term of extractTerms(doc.title)) {
      const key = term.toLowerCase();
      if (existing.has(key) || key.split(" ").some((part) => existing.has(part))) continue;
      const s = stats.get(key) ?? {
        spelling: term,
        docs: 0,
        days: new Set<string>(),
        purposes: new Map<string, number>(),
      };
      s.docs++;
      if (doc.date) s.days.add(doc.date);
      if (doc.purpose) s.purposes.set(doc.purpose, (s.purposes.get(doc.purpose) ?? 0) + 1);
      stats.set(key, s);
    }
  }
  return stats;
}

/**
 * Suggests keywords from recent titles, compared with the background titles before them.
 * The score is document frequency × log(lift); a phrase replaces its words when it is as frequent.
 */
export function discoverKeywordsFromHistory(
  recent: readonly TitleDocument[],
  background: readonly TitleDocument[],
  options: HistoryOptions = {},
): KeywordSuggestion[] {
  const minDf = options.minDocumentFrequency ?? 3;
  const minDays = options.minDistinctDays ?? 2;
  const minLift = options.minLift ?? 2;
  const existing = existingKeywordSet();

  const fg = countTerms(recent, existing);
  const bg = countTerms(background, existing);
  const fgN = recent.length;
  const bgN = background.length;
  const datedRecent = recent.some((d) => d.date);

  const candidates: (KeywordSuggestion & { key: string; score: number })[] = [];
  for (const [key, s] of fg) {
    if (s.docs < minDf) continue;
    if (datedRecent && s.days.size < minDays) continue;
    const bgDocs = bg.get(key)?.docs ?? 0;
    // Add-one smoothing: a term absent from the background gets a finite lift.
    const lift = bgN > 0 ? (s.docs + 1) / (fgN + 1) / ((bgDocs + 1) / (bgN + 1)) : undefined;
    if (lift !== undefined && lift < minLift) continue;

    const topPurpose = [...s.purposes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? guessPurpose(s.spelling);
    const weight = medianWeight(topPurpose) ?? Math.min(10, Math.max(1, Math.round(s.docs / 2)));
    candidates.push({
      key,
      word: s.spelling,
      frequency: s.docs,
      suggestedPurpose: topPurpose,
      suggestedWeight: weight,
      ...(lift !== undefined ? { lift: Math.round(lift * 10) / 10 } : {}),
      score: s.docs * Math.log(1 + (lift ?? 2)),
    });
  }

  // A two-word phrase subsumes its words when it covers (almost) all of their occurrences.
  const phrases = candidates.filter((c) => c.key.includes(" "));
  const kept = candidates.filter((c) => {
    if (c.key.includes(" ")) return true;
    return !phrases.some((p) => p.key.split(" ").includes(c.key) && p.frequency >= c.frequency * 0.8);
  });

  return kept
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, options.limit ?? 20)
    .map(({ key: _key, score: _score, ...suggestion }) => suggestion);
}

/**
 * Extracts candidate keywords from article titles that are NOT currently in any purpose's
 * keyword list (single run, no history): a term must appear in at least 3 titles (5% of them for
 * large runs).
 */
export function discoverCandidateKeywords(articleTitles: string[]): KeywordSuggestion[] {
  const minFrequency = Math.max(3, Math.floor(articleTitles.length * 0.05));
  return discoverKeywordsFromHistory(
    articleTitles.map((title) => ({ title })),
    [],
    {
      minDocumentFrequency: minFrequency,
    },
  );
}

/**
 * Formats keyword suggestions as a human-readable report.
 */
export function formatSuggestionReport(suggestions: KeywordSuggestion[]): string {
  if (suggestions.length === 0) return "No new keyword suggestions this period.";

  const rows = suggestions.map(
    (s) => `| ${s.word} | ${s.frequency} | ${s.lift ?? "—"} | ${s.suggestedPurpose} | ${s.suggestedWeight} |`,
  );

  return `## 🔑 Keyword Expansion Suggestions

| Word | Titles | Lift | Suggested Purpose | Suggested Weight |
|:---|:---:|:---:|:---|:---:|
${rows.join("\n")}

> These terms appeared repeatedly in recently selected articles but are not in any keyword list.
> "Lift" is how much more often they appeared than in the preceding period.
> Review and add relevant terms to \`config.yml\`.`;
}
