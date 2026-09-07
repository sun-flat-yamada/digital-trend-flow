/**
 * Unit tests for Bluesky ingestion module.
 */

import axios from "axios";
import { fetchBluesky } from "../src/ingestion/bluesky";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../src/ingestion/state_manager", () => ({
  isProcessed: jest.fn((url: string) => url.includes("already-processed")),
}));

describe("fetchBluesky", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("fetches and normalizes Bluesky posts into ArticleItem", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: {
        posts: [
          {
            uri: "at://did:plc:123/app.bsky.feed.post/post1",
            author: { handle: "yann-lecun.bsky.social" },
            record: {
              text: "Exciting new paper on energy-based models and reasoning.",
              createdAt: "2026-09-07T12:00:00.000Z",
            },
            likeCount: 50,
            embed: {
              external: {
                uri: "https://arxiv.org/abs/2609.12345",
                title: "Energy-Based Reasoning in LLMs",
              },
            },
          },
          {
            uri: "at://did:plc:123/app.bsky.feed.post/post2",
            author: { handle: "user2.bsky.social" },
            record: { text: "Low like post", createdAt: "2026-09-07T12:00:00.000Z" },
            likeCount: 5,
          },
        ],
      },
    });

    const articles = await fetchBluesky("LLM", 20, 10, "ai_research");

    expect(articles.length).toBe(1);
    expect(articles[0]?.title).toContain("Energy-Based Reasoning in LLMs");
    expect(articles[0]?.title).toContain("♥50");
    expect(articles[0]?.sourceType).toBe("bluesky");
    expect(articles[0]?.url).toBe("https://arxiv.org/abs/2609.12345");
  });

  test("handles API errors gracefully", async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

    const articles = await fetchBluesky("LLM", 20, 10, "ai_research");
    expect(articles).toEqual([]);
  });
});
