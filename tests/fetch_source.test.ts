/**
 * Tests for the source router (src/ingestion/fetch_source.ts): each source type reaches its
 * adapter with the configured options. Adapters are mocked.
 */

import { fetchSource, type SourceWithPurpose } from "../src/ingestion/fetch_source";

const item = { title: "t", url: "https://example.com/a" };
jest.mock("../src/ingestion/rss", () => ({ fetchRss: jest.fn(async () => [item]) }));
jest.mock("../src/ingestion/raindrop", () => ({
  fetchRaindropBookmarks: jest.fn(async () => ({ articles: [item], processedIds: [7], idByUrl: { u: 8 } })),
}));
jest.mock("../src/ingestion/xai_grok", () => ({ fetchXViGrok: jest.fn(async () => [item]) }));
jest.mock("../src/ingestion/hackernews", () => ({ fetchHackerNews: jest.fn(async () => [item]) }));
jest.mock("../src/ingestion/arxiv", () => ({ fetchArxiv: jest.fn(async () => [item]) }));
jest.mock("../src/ingestion/youtube", () => ({ fetchYouTube: jest.fn(async () => [item]) }));
jest.mock("../src/ingestion/github_trending", () => ({ fetchGitHubTrending: jest.fn(async () => [item]) }));
jest.mock("../src/ingestion/reddit", () => ({ fetchReddit: jest.fn(async () => [item]) }));
jest.mock("../src/ingestion/bluesky", () => ({ fetchBluesky: jest.fn(async () => [item]) }));

const adapter = (module: string, name: string): jest.Mock =>
  (require(`../src/ingestion/${module}`) as Record<string, jest.Mock>)[name]!;

const base = { name: "Src", enabled: true, purpose: "tech" } as const;

test.each<[string, string, SourceWithPurpose, unknown[]]>([
  ["rss", "fetchRss", { ...base, type: "rss", url: "https://e.com/feed" }, ["Src", "https://e.com/feed", "tech"]],
  ["xai_grok", "fetchXViGrok", { ...base, type: "xai_grok", query: "AI" }, ["AI", "Src", "tech"]],
  [
    "hackernews",
    "fetchHackerNews",
    { ...base, type: "hackernews", min_score: 100, max_items: 30 },
    ["Src", 100, 30, "tech"],
  ],
  [
    "arxiv",
    "fetchArxiv",
    { ...base, type: "arxiv", query: "cat:cs.AI", max_results: 20 },
    ["cat:cs.AI", "Src", 20, "tech"],
  ],
  [
    "youtube",
    "fetchYouTube",
    { ...base, type: "youtube", query: "agents", max_results: 10 },
    ["Src", "agents", undefined, 10, "tech"],
  ],
  [
    "github_trending",
    "fetchGitHubTrending",
    { ...base, type: "github_trending", language_filter: "rust", since: "weekly" },
    ["Src", "rust", "weekly", "tech"],
  ],
  [
    "reddit",
    "fetchReddit",
    { ...base, type: "reddit", subreddit: "LocalLLaMA", min_score: 50, max_items: 15 },
    ["LocalLLaMA", 50, 15, "tech"],
  ],
  [
    "bluesky",
    "fetchBluesky",
    { ...base, type: "bluesky", query: "AI", min_likes: 20, max_items: 15 },
    ["AI", 20, 15, "tech"],
  ],
])("routes a %s source to %s", async (module, name, source, args) => {
  await expect(fetchSource(source)).resolves.toEqual([item]);
  expect(adapter(module, name)).toHaveBeenCalledWith(...args);
});

test("a Raindrop source returns its articles and hands over the IDs to archive", async () => {
  const onRaindrop = jest.fn();
  const source: SourceWithPurpose = {
    ...base,
    type: "raindrop",
    collection_id: -1,
    archive_collection_id: 555,
    lookback_hours: 48,
  };

  await expect(fetchSource(source, onRaindrop)).resolves.toEqual([item]);

  expect(adapter("raindrop", "fetchRaindropBookmarks")).toHaveBeenCalledWith(-1, "Src", 48, "tech");
  expect(onRaindrop).toHaveBeenCalledWith({
    articles: [item],
    processedIds: [7],
    idByUrl: { u: 8 },
    collectionId: -1,
    archiveId: 555,
  });
});
