/**
 * Unit tests for the source reachability check (src/cli/check_sources.ts). Fetchers are mocked.
 */

import {
  checkSources,
  exitCodeFor,
  formatReport,
  sourcesToCheck,
  type SourceCheckResult,
} from "../src/cli/check_sources";
import type { SourceWithPurpose } from "../src/ingestion/fetch_source";
import type { ArticleItem, Purpose } from "../src/core/types";

jest.mock("../src/core/config", () => ({
  config: { purposes: {} },
  env: { GEMINI_API_KEY: "test-key" }, // no YOUTUBE_API_KEY
}));
jest.mock("../src/ingestion/state_manager", () => ({
  disableStateLookups: jest.fn(),
  isProcessed: jest.fn(() => false),
}));

const purposes = {
  tech: {
    label: "Tech",
    sources: [
      { type: "rss", name: "Working Feed", url: "https://example.com/ok.xml", enabled: true },
      { type: "rss", name: "VentureBeat", url: "https://example.com/vb.xml", enabled: true },
      { type: "rss", name: "Stopped Feed", url: "https://example.com/stopped.xml", enabled: false },
      { type: "youtube", name: "YouTube AI", query: "AI", max_results: 5, enabled: true },
    ],
  },
} as unknown as Record<string, Purpose>;

const item = (url: string): ArticleItem => ({
  sourceName: "x",
  sourceType: "rss",
  purpose: "tech",
  title: "t",
  url,
  publishedAt: "2026-10-17T00:00:00Z",
});

const fetcher = jest.fn(async (source: SourceWithPurpose): Promise<ArticleItem[]> => {
  if (source.name === "VentureBeat") throw new Error("Status code 429");
  if (source.name === "Stopped Feed") return [];
  return [item("https://example.com/a"), item("https://example.com/b")];
});

describe("check:sources", () => {
  let results: SourceCheckResult[];

  beforeAll(async () => {
    results = await checkSources(sourcesToCheck(purposes, ["https://candidate.example.com/feed"]), fetcher);
  });

  test("checks enabled and disabled sources and the candidate URLs, and skips a source without its key", () => {
    expect(results.map((r) => [r.section, r.name, r.status, r.count])).toEqual([
      ["enabled", "Working Feed", "ok", 2],
      ["enabled", "VentureBeat", "error", 0],
      ["disabled", "Stopped Feed", "empty", 0],
      ["enabled", "YouTube AI", "skipped", 0],
      ["candidate", "https://candidate.example.com/feed", "ok", 2],
    ]);
    expect(results[1]?.detail).toBe("Status code 429");
    expect(results[3]?.detail).toBe("YOUTUBE_API_KEY not set");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[0]).toMatchObject({ type: "rss", url: "https://candidate.example.com/feed" });
  });

  test("reports each section as a table with status, items and time", () => {
    const report = formatReport(results);
    expect(report).toContain("### Enabled sources");
    expect(report).toContain("### Disabled sources (enabled: false in config.yml)");
    expect(report).toContain("### Candidate feeds (command-line arguments)");
    expect(report).toMatch(/\| VentureBeat \| rss \| ❌ error \| Status code 429 \| 0 \| \d+\.\ds \|/);
    expect(report).toContain("| YouTube AI | youtube | ⏸️ skipped | YOUTUBE_API_KEY not set | 0 | - |");
    expect(report).toContain("**1 enabled source(s) failed.**");
  });

  test("fails only when an enabled source fails", () => {
    expect(exitCodeFor(results)).toBe(1);
    const withoutEnabledFailure = results.filter((r) => r.name !== "VentureBeat");
    expect(exitCodeFor(withoutEnabledFailure)).toBe(0);
    expect(exitCodeFor([{ ...results[1]!, section: "disabled" }])).toBe(0);
  });
});
