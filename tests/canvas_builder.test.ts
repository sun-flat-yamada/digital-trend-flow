/**
 * Unit tests for Obsidian JSON Canvas generator.
 */

import * as fs from "fs";
import * as path from "path";
import { buildDailyCanvas, saveDailyCanvas } from "../src/storage/canvas_builder";

describe("canvas_builder", () => {
  const tmpDir = path.join(process.cwd(), "_tmp_ai", "test_canvas");

  afterAll(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  test("builds valid JSON Canvas structure", () => {
    const data = buildDailyCanvas({
      date: "2026-09-07",
      topStory: "OpenAI launches revolutionary reasoning agent",
      topStoryUrl: "https://example.com/top",
      purposeGroups: [
        {
          key: "ai_research",
          label: "🔬 AI・LLM 研究",
          articles: [
            { title: "DeepSeek-R1 Architecture", url: "https://example.com/deepseek", score: 25 },
            { title: "Gemini 2.5 Flash Tech Report", url: "https://example.com/gemini", score: 20 },
          ],
        },
      ],
      mentionedCompanies: ["OpenAI", "Google"],
      mentionedTechnologies: ["LLM", "RAG"],
    });

    expect(data.nodes.length).toBeGreaterThanOrEqual(4); // root, entities, 1 purpose, 2 articles
    expect(data.edges.length).toBeGreaterThanOrEqual(3);

    // Verify root node
    const rootNode = data.nodes.find((n) => n.id === "root_daily");
    expect(rootNode).toBeTruthy();
    expect(rootNode?.type).toBe("text");
    expect(rootNode?.text).toContain("OpenAI launches");

    // Verify entities node
    const entitiesNode = data.nodes.find((n) => n.id === "entities_summary");
    expect(entitiesNode).toBeTruthy();
    expect(entitiesNode?.text).toContain("[[Entities/OpenAI|OpenAI]]");
    expect(entitiesNode?.text).toContain("[[Technologies/LLM|LLM]]");

    // Verify edges
    const rootEdge = data.edges.find((e) => e.toNode === "root_daily");
    expect(rootEdge).toBeTruthy();
    expect(rootEdge?.label).toBe("関連エンティティ");
  });

  test("saves canvas file to specified directory", () => {
    const filePath = saveDailyCanvas({
      date: "2026-09-07",
      topStory: "New AI Breakthrough",
      purposeGroups: [
        {
          key: "ai_research",
          label: "🔬 AI・LLM 研究",
          articles: [{ title: "Paper 1", url: "https://example.com/p1" }],
        },
      ],
      outputDir: tmpDir,
    });

    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(content.nodes).toBeInstanceOf(Array);
    expect(content.edges).toBeInstanceOf(Array);
  });
});
