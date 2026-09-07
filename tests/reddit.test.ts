/**
 * Unit tests for Reddit ingestion module.
 */

import axios from "axios";
import { fetchReddit } from "../src/ingestion/reddit";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../src/ingestion/state_manager", () => ({
  isProcessed: jest.fn((url: string) => url.includes("already-processed")),
}));

describe("fetchReddit", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("fetches and normalizes Reddit posts into ArticleItem", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: {
        data: {
          children: [
            {
              data: {
                id: "post1",
                title: "DeepSeek-R1 Local Setup Guide",
                url: "https://github.com/deepseek-ai/DeepSeek-R1",
                permalink: "/r/LocalLLaMA/comments/post1",
                score: 150,
                created_utc: 1725700000,
                is_self: false,
              },
            },
            {
              data: {
                id: "post2",
                title: "Low score post",
                url: "https://example.com/low",
                permalink: "/r/LocalLLaMA/comments/post2",
                score: 10,
                created_utc: 1725700000,
                is_self: false,
              },
            },
            {
              data: {
                id: "post3",
                title: "Already processed post",
                url: "https://already-processed.com",
                permalink: "/r/LocalLLaMA/comments/post3",
                score: 200,
                created_utc: 1725700000,
                is_self: false,
              },
            },
          ],
        },
      },
    });

    const articles = await fetchReddit("LocalLLaMA", 50, 10, "ai_dev_tools");

    expect(articles.length).toBe(1);
    expect(articles[0]?.title).toContain("DeepSeek-R1 Local Setup Guide");
    expect(articles[0]?.title).toContain("▲150");
    expect(articles[0]?.sourceType).toBe("reddit");
    expect(articles[0]?.url).toBe("https://github.com/deepseek-ai/DeepSeek-R1");
  });

  test("handles API errors gracefully", async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error("Network Timeout"));

    const articles = await fetchReddit("LocalLLaMA", 50, 10, "ai_dev_tools");
    expect(articles).toEqual([]);
  });
});
