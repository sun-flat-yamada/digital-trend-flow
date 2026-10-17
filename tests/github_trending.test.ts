/**
 * GitHub Trending is parsed per repository row, from a saved copy of the page's markup.
 */

import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { fetchGitHubTrending, parseTrendingPage } from "../src/ingestion/github_trending";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const isProcessed = jest.fn((_url: string) => false);
jest.mock("../src/ingestion/state_manager", () => ({ isProcessed: (url: string) => isProcessed(url) }));

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "github_trending.html"), "utf8");

describe("parseTrendingPage", () => {
  test("reads name, description, language and stars today from each repository row", () => {
    const repos = parseTrendingPage(FIXTURE);

    expect(repos.map((r) => r.repoPath)).toEqual([
      "jamwithai/production-agentic-rag-course",
      "datalab-to/chandra",
      "meituan-longcat/LongCat-Video",
    ]);
    expect(repos[1]).toEqual({
      repoPath: "datalab-to/chandra",
      description: "OCR model that handles complex tables, forms, handwriting with full layout.",
      language: "Python",
      starsToday: 512,
    });
  });

  test("a repository without a description does not take another repository's description", () => {
    const repos = parseTrendingPage(FIXTURE);

    expect(repos[0]?.description).toBeUndefined();
    expect(repos[2]?.description).toBeUndefined();
    expect(repos[0]?.starsToday).toBe(1317);
    expect(repos[2]?.language).toBeUndefined();
  });
});

describe("fetchGitHubTrending", () => {
  afterEach(() => jest.clearAllMocks());

  test("returns undecorated items and skips processed repositories", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: FIXTURE });
    isProcessed.mockImplementation((url) => url.endsWith("/datalab-to/chandra"));

    const items = await fetchGitHubTrending("GitHub Trending (Python)", "python", "daily", "ai_dev_tools");

    expect(items.map((i) => i.url)).toEqual([
      "https://github.com/jamwithai/production-agentic-rag-course",
      "https://github.com/meituan-longcat/LongCat-Video",
    ]);
    expect(items[0]).toMatchObject({
      title: "jamwithai/production-agentic-rag-course",
      sourceType: "github_trending",
      purpose: "ai_dev_tools",
      engagement: { starsToday: 1317 },
    });
    expect(items[0]).not.toHaveProperty("description");
  });

  test("a page without any repository row fails, so a markup change is noticed", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: "<html><body><p>Something changed</p></body></html>" });

    await expect(fetchGitHubTrending("GitHub Trending")).rejects.toThrow(/no repositories/);
  });
});
