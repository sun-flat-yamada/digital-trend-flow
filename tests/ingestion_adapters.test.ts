/**
 * Tests for the RSS, arXiv and Raindrop adapters against HTTP response fixtures (tests/fixtures/):
 * normal responses, failures, and the exclusion of URLs already processed.
 */

import axios from "axios";
import Parser from "rss-parser";
import { fetchRss } from "../src/ingestion/rss";
import { fetchArxiv } from "../src/ingestion/arxiv";
import { archiveProcessedRaindrops, archivableRaindropIds, fetchRaindropBookmarks } from "../src/ingestion/raindrop";
import { loadFixture } from "./fixtures/load";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockEnv: Record<string, string | undefined> = {};
jest.mock("../src/core/config", () => ({
  config: { exclude: { url_strip_parameters: ["utm_source"] } },
  env: new Proxy({}, { get: (_t, key: string) => mockEnv[key] }),
}));

const processed = new Set<string>();
jest.mock("../src/ingestion/state_manager", () => ({
  isProcessed: jest.fn((url: string) => processed.has(url)),
}));

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());
beforeEach(() => {
  processed.clear();
  mockedAxios.get.mockReset();
  mockedAxios.put.mockReset();
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

describe("fetchRss", () => {
  const parseFixture = () =>
    jest.spyOn(Parser.prototype, "parseURL").mockImplementation(function (this: Parser) {
      return this.parseString(loadFixture("rss_feed.xml", "rfc1123"));
    });

  afterEach(() => jest.mocked(Parser.prototype.parseURL).mockRestore());

  test("returns the recent, unprocessed items with their description", async () => {
    parseFixture();
    processed.add("https://news.example.com/articles/already-summarized");

    const items = await fetchRss("Example", "https://news.example.com/feed.xml", "tech");

    expect(items.map((i) => i.url)).toEqual([
      "https://news.example.com/articles/open-weight-model",
      "https://news.example.com/articles/undated",
    ]);
    expect(items[0]).toMatchObject({
      sourceName: "Example",
      sourceType: "rss",
      purpose: "tech",
      title: "New open-weight model tops the coding benchmarks",
      description: "The model scores 71% on SWE-bench Verified.",
    });
    // An undated item is kept and stamped with the fetch time.
    expect(Date.now() - new Date(items[1]!.publishedAt).getTime()).toBeLessThan(60_000);
    expect(items[1]?.description).toBeUndefined();
  });

  test("keeps only the items within the given lookback window", async () => {
    parseFixture();

    const items = await fetchRss("Example", "https://news.example.com/feed.xml", "tech", 3);

    expect(items.map((i) => i.url)).toEqual([
      "https://news.example.com/articles/open-weight-model",
      "https://news.example.com/articles/undated",
    ]);
  });

  test("wraps a fetch failure with the source name", async () => {
    jest.spyOn(Parser.prototype, "parseURL").mockRejectedValue(new Error("Status code 429"));

    await expect(fetchRss("VentureBeat", "https://venturebeat.com/feed/", "tech")).rejects.toThrow(
      "Failed to fetch RSS feed [VentureBeat]: Status code 429",
    );
  });
});

describe("fetchArxiv", () => {
  test("returns unprocessed papers with https URLs and collapsed whitespace", async () => {
    mockedAxios.get.mockResolvedValue({ data: loadFixture("arxiv_query.xml") });
    processed.add("https://arxiv.org/abs/2610.05678v2");

    const items = await fetchArxiv("cat:cs.AI", "arXiv AI", 5, "ai_research");

    expect(items).toEqual([
      {
        sourceName: "arXiv AI",
        sourceType: "arxiv",
        purpose: "ai_research",
        title: "Scaling Test-Time Compute for Agentic Coding",
        url: "https://arxiv.org/abs/2610.01234v1",
        publishedAt: "2026-10-16T17:59:59Z",
        description: "We study how test-time compute scales for coding agents.",
      },
    ]);
    expect(mockedAxios.get.mock.calls[0]?.[1]).toMatchObject({
      params: { search_query: "cat:cs.AI", max_results: 5, sortBy: "submittedDate" },
    });
  });

  test("propagates a failed request", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Request failed with status code 503"));

    await expect(fetchArxiv("cat:cs.AI")).rejects.toThrow("arXiv fetch failed: Request failed with status code 503");
  });
});

describe("fetchRaindropBookmarks", () => {
  const page = () => JSON.parse(loadFixture("raindrop_page.json")) as { items: Record<string, unknown>[] };

  test("is skipped without a token", async () => {
    await expect(fetchRaindropBookmarks(-1, "Inbox")).resolves.toEqual({
      articles: [],
      processedIds: [],
      idByUrl: {},
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  test("returns new bookmarks within the lookback window and stops at the first older one", async () => {
    mockEnv["RAINDROP_TEST_TOKEN"] = "token";
    mockedAxios.get.mockResolvedValue({ data: page() });
    processed.add("https://blog.example.com/already");

    const result = await fetchRaindropBookmarks(-1, "Inbox", 48, "curated");

    expect(result.articles.map((a) => [a.title, a.url])).toEqual([
      ["Clipped article about agent frameworks", "https://blog.example.com/agents?utm_source=raindrop"],
      ["Untitled", "https://blog.example.com/untitled"],
    ]);
    expect(result.articles[0]).toMatchObject({ sourceName: "Raindrop: Inbox", sourceType: "raindrop" });
    expect(result.processedIds).toEqual([102]);
    // Keyed by canonical URL, so the summarized URL finds its bookmark.
    expect(result.idByUrl).toEqual({
      "https://blog.example.com/agents": 101,
      "https://blog.example.com/untitled": 103,
    });
    expect(archivableRaindropIds(result, ["https://blog.example.com/agents"])).toEqual([102, 101]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer token" },
      params: { page: 0, sort: "-created" },
    });
  });

  test("reads the next page while a page is full", async () => {
    mockEnv["RAINDROP_TEST_TOKEN"] = "token";
    const recent = page().items[0]!;
    const fullPage = Array.from({ length: 50 }, (_, i) => ({ ...recent, _id: i, link: `https://e.com/${i}` }));
    mockedAxios.get
      .mockResolvedValueOnce({ data: { items: fullPage } })
      .mockResolvedValueOnce({ data: { items: [{ ...recent, _id: 50, link: "https://e.com/50" }] } });

    const result = await fetchRaindropBookmarks(-1, "Inbox");

    expect(result.articles).toHaveLength(51);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get.mock.calls[1]?.[1]).toMatchObject({ params: { page: 1 } });
  });

  test("propagates a failed request", async () => {
    mockEnv["RAINDROP_TEST_TOKEN"] = "token";
    mockedAxios.get.mockRejectedValue(new Error("Request failed with status code 401"));

    await expect(fetchRaindropBookmarks(-1, "Inbox")).rejects.toThrow(
      'Failed to fetch Raindrop bookmarks for "Inbox": Request failed with status code 401',
    );
  });

  test("archiving moves the bookmarks, and a failure does not throw", async () => {
    mockEnv["RAINDROP_TEST_TOKEN"] = "token";
    mockedAxios.put.mockResolvedValueOnce({ data: { result: true } });

    await archiveProcessedRaindrops(-1, [101, 102], 555);
    expect(mockedAxios.put).toHaveBeenCalledWith(
      "https://api.raindrop.io/rest/v1/raindrops/-1",
      { ids: [101, 102], collection: { $id: 555 } },
      expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
    );

    mockedAxios.put.mockRejectedValueOnce(new Error("Request failed with status code 500"));
    await expect(archiveProcessedRaindrops(-1, [101], 555)).resolves.toBeUndefined();

    await archiveProcessedRaindrops(-1, [101]); // no archive collection configured
    expect(mockedAxios.put).toHaveBeenCalledTimes(2);
  });
});
