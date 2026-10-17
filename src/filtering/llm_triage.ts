/**
 * [Role] Batch LLM triage of freshly ingested candidates, before any body is fetched.
 * [Mechanism] Sends titles, descriptions and source metadata to a cheap model (Flash-Lite) in
 * one or two structured-output calls, and gets back per-candidate relevance, purpose, importance
 * and duplicate-of. Only the top candidates are then extracted with Jina. This replaces the
 * keyword title pre-screen (`titlePassesPreScreen`), which stays as the fallback path when
 * triage fails.
 *
 * Plan items: 2-1, §7.5 (SCO-2, SCO-6, SCO-7)
 */

import { z } from "zod";
import type { ArticleItem } from "../ingestion/rss";
import type { Purpose } from "../core/types";
import type { LLMRequest, LLMResponse } from "../summarization/llm_gateway";
import { getTriagePrompt, TRIAGE_RESPONSE_SCHEMA } from "../summarization/prompts";
import { mapWithConcurrency } from "../core/concurrency";

export interface TriageSettings {
  model?: string | undefined; // defaults to settings.models.map inside the gateway
  max_candidates: number;
  batch_size: number;
  min_relevance: number;
}

export interface TriagePurpose {
  key: string;
  label: string;
  minQuota: number;
  hints: string[]; // highest-weighted keywords, as a description of the purpose
}

export interface TriageVerdict {
  id: number;
  relevance: number; // 0-100
  purpose: string; // a purpose key, or "none"
  importance: number; // 1-10
  duplicate_of: number; // id of another candidate on the same story, or -1
}

export interface TriageDecision<T> {
  item: T;
  purpose: string;
  relevance: number;
  importance: number;
}

export interface TriageStats {
  candidates: number;
  kept: number;
  dropped_irrelevant: number;
  dropped_duplicate: number;
  dropped_over_limit: number;
  batches: number;
}

export type TriageResult<T> =
  | { status: "ok"; kept: TriageDecision<T>[]; stats: TriageStats }
  | { status: "failed"; error: string; stats: TriageStats };

type LlmCall = (request: LLMRequest) => Promise<LLMResponse>;

const DESCRIPTION_CHARS = 200;
const HINT_KEYWORDS = 12;
// A response that leaves out more than this share of a batch is treated as a failed call.
const MIN_COVERAGE = 0.8;

// ── Purposes ──

/** Purposes the triage may assign: every purpose with keyword scoring (curated has none). */
export function triagePurposes(purposes: Record<string, Purpose>): TriagePurpose[] {
  return Object.entries(purposes)
    .filter(([, p]) => p.scoring !== null)
    .map(([key, p]) => ({
      key,
      label: p.label,
      minQuota: p.quota.min,
      hints: [...(p.scoring?.keywords ?? [])]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, HINT_KEYWORDS)
        .map((k) => k.word),
    }));
}

// ── Prompt ──

export function buildTriageUserPrompt(purposes: TriagePurpose[], batch: { id: number; item: ArticleItem }[]): string {
  const purposeLines = purposes.map((p) => `- ${p.key}: ${p.label} (e.g. ${p.hints.join(", ")})`).join("\n");
  const candidateLines = batch
    .map(({ id, item }) =>
      JSON.stringify({
        id,
        title: item.title,
        source: `${item.sourceName} (${item.sourceType})`,
        ...(item.description ? { description: item.description.replace(/\s+/g, " ").slice(0, DESCRIPTION_CHARS) } : {}),
      }),
    )
    .join("\n");
  return `Purposes:\n${purposeLines}\n\nCandidates (one JSON object per line):\n${candidateLines}`;
}

// ── Response parsing ──

const VerdictSchema = z.object({
  id: z.number().int(),
  relevance: z.number(),
  purpose: z.string(),
  importance: z.number(),
  duplicate_of: z.number().int().default(-1),
});
const ResponseSchema = z.object({ items: z.array(VerdictSchema) });

/** Parses one batch's response. Throws when it is malformed or leaves out too much of the batch. */
export function parseTriageResponse(text: string, batchIds: number[]): TriageVerdict[] {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const parsed = ResponseSchema.parse(JSON.parse(cleaned));
  const expected = new Set(batchIds);
  const byId = new Map<number, TriageVerdict>();
  for (const v of parsed.items) {
    if (expected.has(v.id) && !byId.has(v.id)) {
      byId.set(v.id, {
        ...v,
        relevance: Math.max(0, Math.min(100, v.relevance)),
        importance: Math.max(1, Math.min(10, v.importance)),
      });
    }
  }
  if (byId.size < Math.ceil(batchIds.length * MIN_COVERAGE)) {
    throw new Error(`Triage response covered ${byId.size}/${batchIds.length} candidates`);
  }
  return [...byId.values()];
}

// ── Decision ──

const byRank = (a: TriageVerdict, b: TriageVerdict) =>
  b.importance - a.importance || b.relevance - a.relevance || a.id - b.id;

/**
 * Turns verdicts into the candidates to extract: drops irrelevant ones, keeps the best-ranked
 * candidate of each duplicate group, then caps the list at max_candidates while first giving
 * every purpose its minimum quota. Pure, so it can be tested without an LLM.
 */
export function resolveTriage(
  verdicts: TriageVerdict[],
  purposes: TriagePurpose[],
  settings: Pick<TriageSettings, "max_candidates" | "min_relevance">,
): { kept: TriageVerdict[]; dropped_irrelevant: number; dropped_duplicate: number; dropped_over_limit: number } {
  const purposeKeys = new Set(purposes.map((p) => p.key));
  const isRelevant = (v: TriageVerdict) => v.relevance >= settings.min_relevance && purposeKeys.has(v.purpose);

  // Duplicate groups (union-find over duplicate_of links between known ids)
  const parent = new Map<number, number>(verdicts.map((v) => [v.id, v.id]));
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const v of verdicts) {
    if (v.duplicate_of !== v.id && parent.has(v.duplicate_of)) {
      parent.set(find(v.id), find(v.duplicate_of));
    }
  }

  const relevant = verdicts.filter(isRelevant).sort(byRank);
  const dropped_irrelevant = verdicts.length - relevant.length;

  const seenGroups = new Set<number>();
  const unique: TriageVerdict[] = [];
  for (const v of relevant) {
    const group = find(v.id);
    if (seenGroups.has(group)) continue;
    seenGroups.add(group);
    unique.push(v);
  }
  const dropped_duplicate = relevant.length - unique.length;

  // Pass 1: each purpose's minimum quota; Pass 2: fill up by rank.
  const max = Math.max(0, settings.max_candidates);
  const picked = new Set<number>();
  for (const p of purposes) {
    let count = 0;
    for (const v of unique) {
      if (picked.size >= max || count >= p.minQuota) break;
      if (v.purpose === p.key) {
        picked.add(v.id);
        count++;
      }
    }
  }
  for (const v of unique) {
    if (picked.size >= max) break;
    picked.add(v.id);
  }
  const kept = unique.filter((v) => picked.has(v.id));

  return { kept, dropped_irrelevant, dropped_duplicate, dropped_over_limit: unique.length - kept.length };
}

// ── Orchestration ──

/**
 * Triages every candidate. Batches run one at a time, spaced by `intervalMs`, so triage obeys
 * the same rate limit as Map. If any batch fails the whole result is "failed" and the caller
 * falls back to the keyword pre-screen, so one run never mixes triage and keyword scores.
 */
export async function triageArticles<T extends ArticleItem>(
  items: T[],
  purposes: TriagePurpose[],
  settings: TriageSettings,
  call: LlmCall,
  intervalMs: number,
): Promise<TriageResult<T>> {
  const batchSize = Math.max(1, settings.batch_size);
  const batches: { id: number; item: T }[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize).map((item, j) => ({ id: i + j, item })));
  }
  const emptyStats: TriageStats = {
    candidates: items.length,
    kept: 0,
    dropped_irrelevant: 0,
    dropped_duplicate: 0,
    dropped_over_limit: 0,
    batches: batches.length,
  };

  const systemPrompt = getTriagePrompt();
  const results = await mapWithConcurrency(
    batches,
    async (batch) => {
      const response = await call({
        systemPrompt,
        userPrompt: buildTriageUserPrompt(purposes, batch),
        phase: "triage",
        responseSchema: TRIAGE_RESPONSE_SCHEMA,
        temperature: 0.1,
        ...(settings.model ? { model: settings.model } : {}),
      });
      return parseTriageResponse(
        response.text,
        batch.map((b) => b.id),
      );
    },
    1,
    intervalMs,
  );

  const verdicts: TriageVerdict[] = [];
  for (const r of results) {
    if (r.status === "rejected") {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return { status: "failed", error, stats: emptyStats };
    }
    verdicts.push(...r.value);
  }

  const resolved = resolveTriage(verdicts, purposes, settings);
  const kept = resolved.kept.map((v) => ({
    item: items[v.id]!,
    purpose: v.purpose,
    relevance: v.relevance,
    importance: v.importance,
  }));
  return {
    status: "ok",
    kept,
    stats: {
      ...emptyStats,
      kept: kept.length,
      // Candidates the model left out of its response count as irrelevant.
      dropped_irrelevant: resolved.dropped_irrelevant + (items.length - verdicts.length),
      dropped_duplicate: resolved.dropped_duplicate,
      dropped_over_limit: resolved.dropped_over_limit,
    },
  };
}

/**
 * Pipeline score of a triaged article. Importance is on one scale for every purpose, unlike the
 * keyword scores (SCO-5), so quota selection and the Reduce top-story hint compare like with like.
 */
export function triageScore(decision: Pick<TriageDecision<unknown>, "importance" | "relevance">): number {
  return decision.importance * 10 + decision.relevance / 100;
}
