/**
 * Integration tests for the daily pipeline's publication gate (src/main.ts).
 * Every external dependency is mocked. A degraded run must publish nothing, mark no URL as
 * processed, still save its run record, and exit with the "degraded" exit code.
 */

import * as fs from "fs";
import * as path from "path";

const mockConfig = {
  settings: {
    daily_threshold_score: 0,
    llm_judge: { enabled: false, weight: 0.5 },
    language: "en",
    author: "test",
    quality_gate: { min_map_success_rate: 0.5, min_quality_score: 60 },
  },
  purposes: {
    tech: {
      label: "Tech",
      priority: 1,
      quota: { min: 1, max: 5 },
      scoring: { threshold: 0, title_multiplier: 1, keywords: [] },
      sources: [{ type: "rss", name: "Test Feed", url: "https://example.com/feed.xml" }],
    },
  },
  exclude: { domains: [], url_strip_parameters: [], keywords: [], content_length: { min: 0, max: 1_000_000 } },
};

jest.mock("../src/core/config", () => ({
  config: mockConfig,
  env: { GEMINI_API_KEY: "test-key", API_CONCURRENCY: 1, API_INTERVAL_MS: 0 },
}));
jest.mock("../src/core/langfuse", () => ({
  initLangfuse: jest.fn(),
  createTrace: jest.fn(() => null),
  recordQualityScore: jest.fn(),
  flushLangfuse: jest.fn(async () => undefined),
}));
jest.mock("../src/ingestion/state_manager", () => ({
  isProcessed: jest.fn(() => false),
  markAsProcessed: jest.fn(),
  flushState: jest.fn(),
  savePipelineRun: jest.fn(),
  recordSourceHealth: jest.fn(),
  getSourceFailureStreak: jest.fn(() => 0),
  closeDb: jest.fn(),
}));
jest.mock("../src/ingestion/rss", () => ({ fetchRss: jest.fn() }));
jest.mock("../src/ingestion/jina_reader", () => ({ extractMarkdown: jest.fn(async () => "Article body. ".repeat(50)) }));
jest.mock("../src/filtering/scorer", () => ({
  normalizeUrl: (url: string) => url,
  excludeByMetadata: () => ({ excluded: false }),
  titlePassesPreScreen: () => true,
  calculatePurposeScore: () => ({
    isExcluded: false,
    assignedPurpose: "tech",
    purposeLabel: "Tech",
    totalScore: 10,
    matchedKeywords: ["ai"],
  }),
  assignBestPurpose: jest.fn(),
  llmJudgeScore: jest.fn(),
  combineWithJudgeScore: (score: number) => score,
}));
jest.mock("../src/filtering/semantic_dedup", () => ({ semanticDedup: <T>(articles: T[]) => articles }));
jest.mock("../src/filtering/keyword_expansion", () => ({
  discoverCandidateKeywords: () => [],
  formatSuggestionReport: () => "",
}));
jest.mock("../src/summarization/gemini_map", () => ({ mapExtractFacts: jest.fn() }));
jest.mock("../src/summarization/gemini_reduce", () => ({ reduceSummarize: jest.fn() }));
jest.mock("../src/storage/markdown_builder", () => ({
  ...jest.requireActual("../src/storage/markdown_builder"),
  saveMarkdownFile: jest.fn(),
}));
jest.mock("../src/storage/canvas_builder", () => ({ saveDailyCanvas: jest.fn() }));
jest.mock("../src/storage/obsidian_linker", () => ({
  extractMentionedCompanies: () => [],
  extractMentionedTechnologies: () => [],
}));
jest.mock("../src/publishing/discord_notifier", () => ({ notifyDiscord: jest.fn() }));
jest.mock("../src/publishing/slack_notifier", () => ({ notifySlack: jest.fn() }));
jest.mock("../src/publishing/teams_notifier", () => ({ notifyTeams: jest.fn() }));
jest.mock("../src/publishing/email_notifier", () => ({ notifyEmail: jest.fn() }));
jest.mock("../src/publishing/pages_generator", () => ({ generatePagesSite: jest.fn() }));
jest.mock("../src/publishing/podcast_generator", () => ({ generatePodcast: jest.fn() }));
jest.mock("../src/aggregation/trend_analyzer", () => ({
  analyzeTopicTrends: () => [],
  formatTrendAnalysis: () => "",
}));

const ARTICLES = [
  { url: "https://example.com/a", title: "Article A" },
  { url: "https://example.com/b", title: "Article B" },
];

// A summary that passes every quality check (format, length, citations, language, structure).
const GOOD_SUMMARY = `## 🔥 Today's Top Story

### Article A
**Source**: [Article A](https://example.com/a) | **Category**: Tech

${"This technical breakthrough changes how engineering teams plan their architecture. ".repeat(12)}

- **🚀 Technical Breakthrough**: A quantitative advance in model quality.
- **⚠️ Trade-offs & Adoption Considerations**: Higher inference cost for adoption.
- **💡 Recommended Actions for Engineers**: Start a PoC and review the documentation.

## Tech

1. **Article B**: ${"Another technical advance worth tracking for engineering leaders. ".repeat(6)}
   **Source**: [Article B](https://example.com/b)
`;

const tmpDir = path.join(process.cwd(), "_tmp_ai", "test_pipeline_gate");

interface PipelineRun {
  exitCode: number | undefined;
  mocks: Record<string, jest.Mock>;
  githubOutput: string;
  stepSummary: string;
}

/**
 * Loads src/main.ts in a fresh module registry (importing it starts the pipeline) and resolves
 * when the pipeline calls process.exit.
 */
async function runPipeline(configure: (mocks: Record<string, jest.Mock>) => void): Promise<PipelineRun> {
  jest.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const outputPath = path.join(tmpDir, "github_output");
  const summaryPath = path.join(tmpDir, "step_summary.md");
  process.env["GITHUB_OUTPUT"] = outputPath;
  process.env["GITHUB_STEP_SUMMARY"] = summaryPath;

  const mocks: Record<string, jest.Mock> = {
    fetchRss: require("../src/ingestion/rss").fetchRss,
    extractMarkdown: require("../src/ingestion/jina_reader").extractMarkdown,
    mapExtractFacts: require("../src/summarization/gemini_map").mapExtractFacts,
    reduceSummarize: require("../src/summarization/gemini_reduce").reduceSummarize,
    saveMarkdownFile: require("../src/storage/markdown_builder").saveMarkdownFile,
    notifyDiscord: require("../src/publishing/discord_notifier").notifyDiscord,
    notifySlack: require("../src/publishing/slack_notifier").notifySlack,
    notifyTeams: require("../src/publishing/teams_notifier").notifyTeams,
    notifyEmail: require("../src/publishing/email_notifier").notifyEmail,
    generatePagesSite: require("../src/publishing/pages_generator").generatePagesSite,
    generatePodcast: require("../src/publishing/podcast_generator").generatePodcast,
    markAsProcessed: require("../src/ingestion/state_manager").markAsProcessed,
    savePipelineRun: require("../src/ingestion/state_manager").savePipelineRun,
  };
  // Keep metrics JSON out of the working tree.
  jest.spyOn(require("../src/core/metrics").metrics, "persist").mockReturnValue("metrics.json");

  mocks["fetchRss"]!.mockResolvedValue(
    ARTICLES.map((a) => ({
      ...a,
      sourceName: "Test Feed",
      sourceType: "rss",
      purpose: "tech",
      publishedAt: new Date().toISOString(),
    }))
  );
  configure(mocks);

  const exitCode = await new Promise<number | undefined>((resolve) => {
    jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      resolve(code);
    }) as never);
    require("../src/main");
  });

  const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  return { exitCode, mocks, githubOutput: read(outputPath), stepSummary: read(summaryPath) };
}

const mapOutput = (url: string, title: string) => ({
  source_title: title,
  source_url: url,
  facts: [{ text: `Fact about ${title}`, importance: 8 }],
});

const PUBLISHERS = [
  "saveMarkdownFile",
  "notifyDiscord",
  "notifySlack",
  "notifyTeams",
  "notifyEmail",
  "generatePagesSite",
  "generatePodcast",
];

describe("daily pipeline publication gate", () => {
  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
    delete process.env["GITHUB_OUTPUT"];
    delete process.env["GITHUB_STEP_SUMMARY"];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("a run whose Map phase fails entirely is degraded and publishes nothing", async () => {
    const run = await runPipeline((mocks) => {
      mocks["mapExtractFacts"]!.mockRejectedValue(new Error("All LLM providers failed for phase: map"));
    });

    expect(run.exitCode).toBe(2);
    expect(run.mocks["reduceSummarize"]).not.toHaveBeenCalled();
    for (const publisher of PUBLISHERS) {
      expect(run.mocks[publisher]).not.toHaveBeenCalled();
    }
    expect(run.mocks["markAsProcessed"]).not.toHaveBeenCalled();
    expect(run.mocks["savePipelineRun"]).toHaveBeenCalledTimes(1);
    expect(run.mocks["savePipelineRun"]!.mock.calls[0][0]).toMatchObject({
      run_status: "degraded",
      map_attempted: 2,
      map_succeeded: 0,
    });
    expect(run.githubOutput).toContain("run_status=degraded");
    expect(run.stepSummary).toContain("⚠️ degraded");
  });

  test("a run whose Reduce phase falls back to raw facts is degraded", async () => {
    const run = await runPipeline((mocks) => {
      mocks["mapExtractFacts"]!.mockImplementation(async (input: { url: string; title: string }) =>
        mapOutput(input.url, input.title)
      );
      mocks["reduceSummarize"]!.mockResolvedValue({ markdown: "# Fallback Mode", usedFallback: true });
    });

    expect(run.exitCode).toBe(2);
    for (const publisher of PUBLISHERS) {
      expect(run.mocks[publisher]).not.toHaveBeenCalled();
    }
    expect(run.mocks["markAsProcessed"]).not.toHaveBeenCalled();
    expect(run.githubOutput).toContain("run_status=degraded");
  });

  test("a healthy run publishes and marks every summarized article as processed", async () => {
    const run = await runPipeline((mocks) => {
      mocks["mapExtractFacts"]!.mockImplementation(async (input: { url: string; title: string }) =>
        mapOutput(input.url, input.title)
      );
      mocks["reduceSummarize"]!.mockResolvedValue({ markdown: GOOD_SUMMARY, usedFallback: false });
    });

    expect(run.exitCode).toBe(0);
    expect(run.mocks["notifyDiscord"]).toHaveBeenCalledTimes(1);
    expect(run.mocks["saveMarkdownFile"]).toHaveBeenCalledTimes(1);
    expect(run.mocks["markAsProcessed"]).toHaveBeenCalledTimes(2);
    expect(run.githubOutput).toContain("run_status=success");
    // Frontmatter lists source names and the headline the summary leads with.
    expect(run.mocks["saveMarkdownFile"]!.mock.calls[0][6]).toMatchObject({ sources: ["Test Feed"], topStory: "Article A" });
  });

  test("an article whose Map phase failed is left unprocessed so the next run retries it", async () => {
    const run = await runPipeline((mocks) => {
      mocks["mapExtractFacts"]!.mockImplementation(async (input: { url: string; title: string }) => {
        if (input.url.endsWith("/b")) throw new Error("Map response contained no usable facts");
        return mapOutput(input.url, input.title);
      });
      mocks["reduceSummarize"]!.mockResolvedValue({ markdown: GOOD_SUMMARY, usedFallback: false });
    });

    // 1/2 articles is exactly the minimum map success rate, so the run is still published.
    expect(run.exitCode).toBe(0);
    expect(run.mocks["markAsProcessed"]).toHaveBeenCalledTimes(1);
    expect(run.mocks["markAsProcessed"]!.mock.calls[0][0]).toBe("https://example.com/a");
    expect(run.mocks["reduceSummarize"]!.mock.calls[0][0]).toHaveLength(1);
  });

  test("an article whose body cannot be extracted is summarized from the source description", async () => {
    const description = "The source's own summary of article B. ".repeat(10);
    const run = await runPipeline((mocks) => {
      mocks["fetchRss"]!.mockResolvedValue(
        ARTICLES.map((a) => ({
          ...a,
          sourceName: "Test Feed",
          sourceType: "rss",
          purpose: "tech",
          publishedAt: new Date().toISOString(),
          ...(a.url.endsWith("/b") ? { description } : {}),
        }))
      );
      mocks["extractMarkdown"]!.mockImplementation(async (url: string) => {
        if (url.endsWith("/b")) throw new Error("Jina returned HTTP 403");
        return "Article body. ".repeat(50);
      });
      mocks["mapExtractFacts"]!.mockImplementation(async (input: { url: string; title: string }) =>
        mapOutput(input.url, input.title)
      );
      mocks["reduceSummarize"]!.mockResolvedValue({ markdown: GOOD_SUMMARY, usedFallback: false });
    });

    expect(run.exitCode).toBe(0);
    const mapInputB = run.mocks["mapExtractFacts"]!.mock.calls
      .map((call) => call[0] as { url: string; content: string })
      .find((input) => input.url.endsWith("/b"));
    expect(mapInputB?.content).toContain(description.trim());
    expect(run.stepSummary).toContain("| Content Extraction (Failed / Description Fallback) | 0 / 1 of 2 |");
  });

  test("a failing source is reported as an error and listed under Source Alerts", async () => {
    const run = await runPipeline((mocks) => {
      mocks["fetchRss"]!.mockRejectedValue(new Error("Failed to fetch RSS feed [Test Feed]: Status code 404"));
    });

    expect(run.stepSummary).toContain("| Test Feed | rss | error | 0 |");
    expect(run.stepSummary).toContain("### 🚨 Source Alerts");
    expect(run.stepSummary).toContain("Status code 404");
  });

  test("a dry run stops after selection without calling the LLM or publishing", async () => {
    const run = await runPipeline(() => {
      require("../src/core/config").env.DRY_RUN = true;
    });

    expect(run.exitCode).toBe(0);
    expect(run.mocks["mapExtractFacts"]).not.toHaveBeenCalled();
    for (const publisher of PUBLISHERS) {
      expect(run.mocks[publisher]).not.toHaveBeenCalled();
    }
    expect(run.mocks["markAsProcessed"]).not.toHaveBeenCalled();
    expect(run.githubOutput).toContain("run_status=skipped");
    expect(run.stepSummary).toContain("Dry run: stopped after selecting 2 articles");
  });
});
