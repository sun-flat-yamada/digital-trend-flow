/**
 * Source adapters keep the original title and put engagement signals in their own fields,
 * so that deduplication, keyword matching and summary headings see the title as published.
 */

import axios from "axios";
import { fetchHackerNews } from "../src/ingestion/hackernews";
import { fetchYouTube } from "../src/ingestion/youtube";
import { fetchGitHubTrending } from "../src/ingestion/github_trending";
import { describeEngagement } from "../src/core/article";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../src/ingestion/state_manager", () => ({ isProcessed: jest.fn(() => false) }));
jest.mock("../src/core/config", () => ({ env: { YOUTUBE_API_KEY: "test-key" } }));

describe("source titles carry no decoration", () => {
  afterEach(() => jest.clearAllMocks());

  test("Hacker News keeps the story title and records its points", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith("/topstories.json")) return { data: [1] };
      return {
        data: { id: 1, type: "story", title: "Gemini 4 Argon", url: "https://example.com/g4", score: 1637, time: 1 },
      };
    });

    const [item] = await fetchHackerNews("Hacker News", 100, 5, "ai_dev_tools");

    expect(item?.title).toBe("Gemini 4 Argon");
    expect(item?.engagement).toEqual({ score: 1637 });
  });

  test("YouTube keeps the video title and records the channel as author", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: { videoId: "abc" },
            snippet: {
              title: "Agents in production",
              channelTitle: "AI Channel",
              publishedAt: "2026-10-16T00:00:00Z",
              description: "",
            },
          },
        ],
      },
    });

    const [item] = await fetchYouTube("YouTube", "agents");

    expect(item?.title).toBe("Agents in production");
    expect(item?.author).toBe("AI Channel");
  });

  test("GitHub Trending uses the repository as title and records stars today", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: `<article><h2 class="h3"><a href="/acme/agent-kit" class="Link">acme / agent-kit</a></h2>
        <p class="col-9 color-fg-muted">Toolkit for building agents</p>
        <span>1,234 stars today</span></article>`,
    });

    const [item] = await fetchGitHubTrending("GitHub Trending", "python");

    expect(item?.title).toBe("acme/agent-kit");
    expect(item?.description).toBe("Toolkit for building agents");
    expect(item?.engagement).toEqual({ starsToday: 1234 });
  });
});

describe("describeEngagement", () => {
  test("formats the signals a source reported", () => {
    expect(describeEngagement({ sourceType: "hackernews", engagement: { score: 1637 } })).toBe(
      "Hacker News: 1637 points",
    );
    expect(describeEngagement({ sourceType: "reddit", engagement: { score: 150 } })).toBe("Reddit: 150 upvotes");
    expect(describeEngagement({ sourceType: "bluesky", engagement: { likes: 50 } })).toBe("Bluesky: 50 likes");
    expect(describeEngagement({ sourceType: "github_trending", engagement: { starsToday: 12 } })).toBe(
      "GitHub: 12 stars today",
    );
    expect(describeEngagement({ sourceType: "youtube", author: "AI Channel" })).toBe("Channel: AI Channel");
  });

  test("returns undefined when the source reported nothing", () => {
    expect(describeEngagement({ sourceType: "rss" })).toBeUndefined();
  });
});
