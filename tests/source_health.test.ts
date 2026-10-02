/**
 * Tests for source availability and failure-streak alerting.
 */

import { sourceDisabledReason } from "../src/ingestion/source_availability";
import { computeFailureStreak } from "../src/ingestion/state_manager";
import type { Source } from "../src/core/types";

const mockEnv: Record<string, string | undefined> = {};
jest.mock("../src/core/config", () => ({
  config: { settings: { state_ttl_days: 90 }, exclude: { url_strip_parameters: [] } },
  env: new Proxy({}, { get: (_t, key: string) => mockEnv[key] }),
}));

describe("sourceDisabledReason", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  });

  const rss: Source = { type: "rss", name: "Feed", url: "https://example.com/rss", enabled: true };

  test("fetches enabled sources that need no key", () => {
    expect(sourceDisabledReason(rss)).toBeNull();
  });

  test("skips sources disabled in config.yml", () => {
    expect(sourceDisabledReason({ ...rss, enabled: false })).toMatch(/enabled: false/);
  });

  test("skips keyed sources when the key is missing, and fetches them when it is set", () => {
    const raindrop: Source = { type: "raindrop", name: "Inbox", collection_id: -1, lookback_hours: 48, enabled: true };
    expect(sourceDisabledReason(raindrop)).toMatch(/RAINDROP_TEST_TOKEN/);
    mockEnv["RAINDROP_TEST_TOKEN"] = "token";
    expect(sourceDisabledReason(raindrop)).toBeNull();
  });

  test("keeps X/Grok disabled even when the key is set", () => {
    mockEnv["XAI_API_KEY"] = "key";
    expect(sourceDisabledReason({ type: "xai_grok", name: "X", query: "AI", enabled: true })).toMatch(/x_search/);
  });
});

describe("computeFailureStreak", () => {
  test("counts leading error and empty checks", () => {
    expect(
      computeFailureStreak([
        { status: "error", article_count: 0 },
        { status: "empty", article_count: 0 },
        { status: "error", article_count: 0 },
        { status: "ok", article_count: 4 },
        { status: "error", article_count: 0 },
      ])
    ).toBe(3);
  });

  test("a successful or disabled check ends the streak", () => {
    expect(computeFailureStreak([{ status: "ok", article_count: 2 }, { status: "error", article_count: 0 }])).toBe(0);
    expect(computeFailureStreak([{ status: "empty", article_count: 0 }, { status: "disabled", article_count: 0 }])).toBe(1);
  });
});
