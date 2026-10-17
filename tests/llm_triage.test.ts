/**
 * Unit tests for the batch LLM triage (src/filtering/llm_triage.ts, plan 2-1).
 * The LLM is a stub: these tests cover parsing, duplicate handling, the candidate cap and the
 * failure contract the pipeline's keyword fallback relies on.
 */

import {
  buildTriageUserPrompt,
  parseTriageResponse,
  resolveTriage,
  triageArticles,
  triagePurposes,
  triageScore,
  type TriagePurpose,
  type TriageVerdict,
} from "../src/filtering/llm_triage";
import type { ArticleItem } from "../src/ingestion/rss";
import type { LLMRequest, LLMResponse } from "../src/summarization/llm_gateway";
import type { Purpose } from "../src/core/types";

jest.mock("../src/core/config", () => ({
  config: { settings: {}, purposes: {}, exclude: {} },
  env: { GEMINI_API_KEY: "test-key", API_CONCURRENCY: 1, API_INTERVAL_MS: 0 },
}));

const PURPOSES: TriagePurpose[] = [
  { key: "ai_research", label: "AI", minQuota: 1, hints: ["LLM"] },
  { key: "geopolitics", label: "Geopolitics", minQuota: 1, hints: ["election"] },
];

const SETTINGS = { max_candidates: 30, batch_size: 150, min_relevance: 50 };

const verdict = (id: number, overrides: Partial<TriageVerdict> = {}): TriageVerdict => ({
  id,
  relevance: 80,
  purpose: "ai_research",
  importance: 5,
  duplicate_of: -1,
  ...overrides,
});

const item = (n: number, overrides: Partial<ArticleItem> = {}): ArticleItem => ({
  sourceName: "Feed",
  sourceType: "rss",
  purpose: "ai_research",
  title: `Title ${n}`,
  url: `https://example.com/${n}`,
  publishedAt: "2026-10-17T00:00:00Z",
  ...overrides,
});

const response = (text: string): LLMResponse => ({
  text,
  model: "gemini-3.1-flash-lite",
  provider: "google",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 1,
});

describe("triagePurposes", () => {
  test("lists scoring purposes with their top keywords, and leaves out curated", () => {
    const purposes = {
      ai_research: {
        label: "AI",
        priority: 1,
        quota: { min: 2, max: 5 },
        scoring: { threshold: 8, title_multiplier: 2, keywords: [{ word: "AI", weight: 4 }, { word: "LLM", weight: 12 }] },
        sources: [],
      },
      curated: { label: "Curated", priority: 5, quota: { min: 0, max: 3 }, scoring: null, sources: [] },
    } as Record<string, Purpose>;

    expect(triagePurposes(purposes)).toEqual([{ key: "ai_research", label: "AI", minQuota: 2, hints: ["LLM", "AI"] }]);
  });
});

describe("buildTriageUserPrompt", () => {
  test("includes each candidate's id, title, source and a shortened description", () => {
    const prompt = buildTriageUserPrompt(PURPOSES, [{ id: 7, item: item(7, { description: "x".repeat(500) }) }]);
    expect(prompt).toContain("- ai_research: AI (e.g. LLM)");
    const line = prompt.split("\n").find((l) => l.startsWith("{"))!;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ id: 7, title: "Title 7", source: "Feed (rss)" });
    expect(parsed.description).toHaveLength(200);
  });
});

describe("parseTriageResponse", () => {
  test("parses verdicts, clamps the scales and ignores unknown or repeated ids", () => {
    const text = JSON.stringify({
      items: [
        { id: 0, relevance: 140, purpose: "ai_research", importance: 0, duplicate_of: -1 },
        { id: 0, relevance: 10, purpose: "none", importance: 1, duplicate_of: -1 },
        { id: 1, relevance: 20, purpose: "none", importance: 2, duplicate_of: -1 },
        { id: 99, relevance: 90, purpose: "ai_research", importance: 9, duplicate_of: -1 },
      ],
    });
    const verdicts = parseTriageResponse("```json\n" + text + "\n```", [0, 1]);
    expect(verdicts).toEqual([
      { id: 0, relevance: 100, purpose: "ai_research", importance: 1, duplicate_of: -1 },
      { id: 1, relevance: 20, purpose: "none", importance: 2, duplicate_of: -1 },
    ]);
  });

  test("throws on malformed JSON", () => {
    expect(() => parseTriageResponse("not json", [0])).toThrow();
  });

  test("throws when the response leaves out too much of the batch", () => {
    const text = JSON.stringify({ items: [{ id: 0, relevance: 90, purpose: "ai_research", importance: 5, duplicate_of: -1 }] });
    expect(() => parseTriageResponse(text, [0, 1, 2])).toThrow("covered 1/3");
  });
});

describe("resolveTriage", () => {
  test("drops low-relevance candidates and candidates with no known purpose", () => {
    const result = resolveTriage(
      [verdict(0), verdict(1, { relevance: 49 }), verdict(2, { purpose: "none" }), verdict(3, { purpose: "sports" })],
      PURPOSES,
      SETTINGS
    );
    expect(result.kept.map((v) => v.id)).toEqual([0]);
    expect(result.dropped_irrelevant).toBe(3);
  });

  test("keeps only the most important candidate of a duplicate group, following chains", () => {
    // 1 → 2 → 0 and 3 → 0 all report the same story; 2 is the most important.
    const result = resolveTriage(
      [
        verdict(0, { importance: 5 }),
        verdict(1, { importance: 4, duplicate_of: 2 }),
        verdict(2, { importance: 9, duplicate_of: 0 }),
        verdict(3, { importance: 6, duplicate_of: 0 }),
        verdict(4, { importance: 3 }),
      ],
      PURPOSES,
      SETTINGS
    );
    expect(result.kept.map((v) => v.id)).toEqual([2, 4]);
    expect(result.dropped_duplicate).toBe(3);
  });

  test("ignores self-references, cycles and links to unknown ids without dropping both sides", () => {
    const result = resolveTriage(
      [
        verdict(0, { duplicate_of: 0 }),
        verdict(1, { importance: 7, duplicate_of: 2 }),
        verdict(2, { importance: 3, duplicate_of: 1 }),
        verdict(3, { duplicate_of: 42 }),
      ],
      PURPOSES,
      SETTINGS
    );
    expect(result.kept.map((v) => v.id).sort()).toEqual([0, 1, 3]);
    expect(result.dropped_duplicate).toBe(1);
  });

  test("a duplicate of an irrelevant candidate is still kept", () => {
    const result = resolveTriage([verdict(0, { relevance: 10 }), verdict(1, { duplicate_of: 0 })], PURPOSES, SETTINGS);
    expect(result.kept.map((v) => v.id)).toEqual([1]);
  });

  test("caps the list at max_candidates by importance, after each purpose's minimum quota", () => {
    const result = resolveTriage(
      [
        verdict(0, { importance: 9 }),
        verdict(1, { importance: 8 }),
        verdict(2, { importance: 7 }),
        verdict(3, { importance: 2, purpose: "geopolitics" }),
      ],
      PURPOSES,
      { ...SETTINGS, max_candidates: 2 }
    );
    expect(result.kept.map((v) => v.id)).toEqual([0, 3]);
    expect(result.dropped_over_limit).toBe(2);
  });
});

describe("triageArticles", () => {
  test("splits candidates into batches of batch_size and maps verdicts back to the items", async () => {
    const items = [item(0), item(1), item(2)];
    const calls: LLMRequest[] = [];
    const call = jest.fn(async (request: LLMRequest) => {
      calls.push(request);
      const ids = [...request.userPrompt.matchAll(/"id":(\d+)/g)].map((m) => Number(m[1]));
      return response(
        JSON.stringify({
          items: ids.map((id) => ({ id, relevance: id === 1 ? 10 : 80, purpose: "ai_research", importance: 10 - id, duplicate_of: -1 })),
        })
      );
    });

    const result = await triageArticles(items, PURPOSES, { ...SETTINGS, batch_size: 2, model: "custom-model" }, call, 0);

    expect(call).toHaveBeenCalledTimes(2);
    expect(calls[0]).toMatchObject({ phase: "triage", model: "custom-model" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.kept.map((d) => d.item.url)).toEqual(["https://example.com/0", "https://example.com/2"]);
    expect(result.stats).toEqual({
      candidates: 3,
      kept: 2,
      dropped_irrelevant: 1,
      dropped_duplicate: 0,
      dropped_over_limit: 0,
      batches: 2,
    });
  });

  test("counts candidates the model left out as irrelevant", async () => {
    const items = [0, 1, 2, 3, 4].map((n) => item(n));
    const call = jest.fn(async () =>
      response(JSON.stringify({ items: [0, 1, 2, 3].map((id) => ({ id, relevance: 80, purpose: "ai_research", importance: 5, duplicate_of: -1 })) }))
    );
    const result = await triageArticles(items, PURPOSES, SETTINGS, call, 0);
    expect(result.stats).toMatchObject({ kept: 4, dropped_irrelevant: 1 });
  });

  test("reports failure when any batch fails, so the caller can fall back", async () => {
    const call = jest
      .fn<Promise<LLMResponse>, [LLMRequest]>()
      .mockResolvedValueOnce(response(JSON.stringify({ items: [{ id: 0, relevance: 80, purpose: "ai_research", importance: 5, duplicate_of: -1 }] })))
      .mockRejectedValueOnce(new Error("All LLM providers failed for phase: triage"));

    const result = await triageArticles([item(0), item(1)], PURPOSES, { ...SETTINGS, batch_size: 1 }, call, 0);

    expect(result).toMatchObject({ status: "failed", error: "All LLM providers failed for phase: triage" });
  });
});

describe("triageScore", () => {
  test("orders by importance first, relevance second", () => {
    expect(triageScore({ importance: 8, relevance: 60 })).toBeGreaterThan(triageScore({ importance: 7, relevance: 100 }));
    expect(triageScore({ importance: 7, relevance: 90 })).toBeGreaterThan(triageScore({ importance: 7, relevance: 60 }));
  });
});
