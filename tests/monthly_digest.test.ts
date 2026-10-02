/**
 * Tests for monthly_digest.ts: an LLM failure must fail the run instead of looking like an
 * empty month.
 */

import * as fs from "fs";
import * as path from "path";

const mockRoot = path.resolve(__dirname, "..", "_tmp_ai", "test_monthly_digest");

jest.mock("../src/core/paths", () => ({
  PATHS: {
    ARTIFACTS_DAILY: { absolute: require("path").join(mockRoot, "daily") },
    ARTIFACTS_MONTHLY: { absolute: require("path").join(mockRoot, "monthly") },
  },
}));
jest.mock("../src/core/config", () => ({ config: { settings: { author: "test" } } }));
jest.mock("../src/summarization/prompts", () => ({ getMonthlyReducePrompt: () => "system" }));
jest.mock("../src/summarization/llm_gateway", () => ({ llmCall: jest.fn() }));

import { generateMonthlyDigest } from "../src/aggregation/monthly_digest";
import { llmCall } from "../src/summarization/llm_gateway";

describe("generateMonthlyDigest", () => {
  beforeAll(() => {
    const dir = path.join(mockRoot, "daily", "2026", "09");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "2026-09-01_digital-trend_daily_summary.md"),
      "---\ntitle: Daily Summary 2026-09-01\narticles_processed: 3\n---\n\n## 🔥 Top\n### Story\n",
      "utf8"
    );
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterAll(() => {
    fs.rmSync(mockRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test("throws when the LLM call fails", async () => {
    (llmCall as jest.Mock).mockRejectedValueOnce(new Error("All LLM providers failed for phase: reduce"));

    await expect(generateMonthlyDigest("2026-09")).rejects.toThrow(
      "Monthly digest generation failed for 2026-09: All LLM providers failed"
    );
  });

  test("resolves with null for a month without daily summaries", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(generateMonthlyDigest("2026-08")).resolves.toBeNull();
  });
});
