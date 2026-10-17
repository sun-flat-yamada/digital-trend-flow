import * as fs from "fs";
import * as path from "path";
import {
  buildReducePrompt,
  getMapPrompt,
  getMonthlyReducePrompt,
  getTriagePrompt,
  getWeeklyReducePrompt,
  getYearlyReducePrompt,
  loadPrompt,
  promptHash,
} from "../src/summarization/prompts";
import { metrics } from "../src/core/metrics";
import { getI18n } from "../src/publishing/pages_generator";

const PROMPTS_DIR = path.resolve(__dirname, "..", "prompts");

describe("prompt files (prompts/ is the only definition)", () => {
  const tmp = path.resolve(__dirname, "..", "_tmp_ai", "test_prompts");

  function writePrompts(manifest: unknown, files: Record<string, string>): void {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(tmp, name), text);
  }

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("every file the manifest names exists", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PROMPTS_DIR, "manifest.json"), "utf8")) as {
      active: Record<string, string | Record<string, string>>;
    };
    const files = Object.values(manifest.active).flatMap((e) => (typeof e === "string" ? [e] : Object.values(e)));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(fs.existsSync(path.join(PROMPTS_DIR, file))).toBe(true);
  });

  it("loads every prompt without leaving a placeholder", () => {
    const prompts = [
      getMapPrompt(),
      getTriagePrompt(),
      buildReducePrompt([{ key: "a", label: "A" }], "ja"),
      buildReducePrompt([{ key: "a", label: "A" }], "en"),
      ...["ja", "en", "French"].flatMap((lang) => [
        getWeeklyReducePrompt(lang),
        getMonthlyReducePrompt(lang),
        getYearlyReducePrompt(lang),
      ]),
    ];
    for (const prompt of prompts) {
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    }
    expect(getMapPrompt()).toBe(fs.readFileSync(path.join(PROMPTS_DIR, "map_v1.md"), "utf8").trim());
  });

  it("selects the periodic prompt by language: Japanese file for ja, English file otherwise", () => {
    expect(getWeeklyReducePrompt("ja")).toContain("今週のトレンド概要");
    expect(getMonthlyReducePrompt("Japanese")).toContain("今月のトレンド概要");
    expect(getYearlyReducePrompt("en")).toContain("Write the report in fluent, professional, and natural English.");
    expect(getMonthlyReducePrompt("de")).toContain("Write the entire report in fluent, professional de.");
  });

  it("records the file and hash of each prompt it loads in the run metrics", () => {
    getWeeklyReducePrompt("ja");
    const template = fs.readFileSync(path.join(PROMPTS_DIR, "weekly_reduce_ja_v1.md"), "utf8").trim();
    expect(metrics.getSnapshot().prompts?.["weekly_reduce"]).toBe(`weekly_reduce_ja_v1.md@${promptHash(template)}`);
    buildReducePrompt([], "en");
    expect(metrics.getSnapshot().prompts?.["reduce"]).toMatch(/^reduce_en_v1\.md@[0-9a-f]{8}$/);
  });

  it("fails instead of falling back when the manifest, an entry or a file is missing", () => {
    expect(() => loadPrompt("map", "en", {}, path.join(tmp, "nowhere"))).toThrow("Prompt manifest not found");

    writePrompts({ active: { map: "missing.md", reduce: { ja: "r_ja.md" } }, history: [] }, { "r_ja.md": "x" });
    expect(() => loadPrompt("map", "en", {}, tmp)).toThrow("Prompt file not found");
    expect(() => loadPrompt("triage", "en", {}, tmp)).toThrow('Prompt "triage" is not listed');
    expect(() => loadPrompt("reduce", "en", {}, tmp)).toThrow('Prompt "reduce" has no en file');
  });

  it("fills placeholders and fails on a placeholder without a value", () => {
    writePrompts({ active: { p: "p.md" }, history: [] }, { "p.md": "Hello {{name}}!\n" });
    expect(loadPrompt("p", "en", { name: "world" }, tmp)).toBe("Hello world!");
    expect(() => loadPrompt("p", "en", {}, tmp)).toThrow("placeholder {{name}} with no value");
  });
});

describe("multilingual prompts & i18n", () => {
  const purposes = [
    { key: "ai_research", label: "🔬 AI Research" },
    { key: "business", label: "💼 Business" },
  ];

  describe("buildReducePrompt", () => {
    it("should generate English prompt by default", () => {
      const prompt = buildReducePrompt(purposes);
      expect(prompt).toContain("## 🔥 Today's Top Story");
      expect(prompt).toContain("**Source**:");
      expect(prompt).toContain("Technical Breakthrough / Quantitative Advance");
      expect(prompt).toContain("Trade-offs & Adoption Considerations");
      expect(prompt).toContain("Recommended Actions for Engineers");
      expect(prompt).toContain("Write the briefing in fluent, professional, and natural English.");
    });

    it("should generate Japanese prompt when target is ja", () => {
      const prompt = buildReducePrompt(purposes, "ja");
      expect(prompt).toContain("## 🔥 本日の最重要ニュース");
      expect(prompt).toContain("**出典**:");
      expect(prompt).toContain("技術的ブレークスルー / 定量進歩");
      expect(prompt).toContain("採用・導入のトレードオフ");
      expect(prompt).toContain("エンジニアへの推奨アクション");
      expect(prompt).toContain("日本語で執筆すること。");
    });

    it("should generate Japanese prompt when target is Japanese", () => {
      const prompt = buildReducePrompt(purposes, "Japanese");
      expect(prompt).toContain("## 🔥 本日の最重要ニュース");
    });

    it("should generate prompt with language instruction for arbitrary languages", () => {
      const promptFr = buildReducePrompt(purposes, "French");
      expect(promptFr).toContain("Write the entire briefing in fluent, professional French.");
      expect(promptFr).toContain("## 🔥 Today's Top Story");

      const promptDe = buildReducePrompt(purposes, "German");
      expect(promptDe).toContain("Write the entire briefing in fluent, professional German.");
    });
  });

  describe("getI18n", () => {
    it("should return English i18n by default", () => {
      const i18n = getI18n();
      expect(i18n.langCode).toBe("en");
      expect(i18n.tabCalendar).toBe("📅 Calendar");
      expect(i18n.tabList).toBe("📋 Archive List");
      expect(i18n.headlineBadge).toBe("🌟 TODAY'S HEADLINE");
      expect(i18n.calLegendToday).toBe("Today");
    });

    it("should return Japanese i18n for ja", () => {
      const i18n = getI18n("ja");
      expect(i18n.langCode).toBe("ja");
      expect(i18n.tabCalendar).toBe("📅 カレンダー");
      expect(i18n.tabList).toBe("📋 リスト一覧");
      expect(i18n.calLegendToday).toBe("本日");
    });

    it("should return Japanese i18n for Japanese", () => {
      const i18n = getI18n("Japanese");
      expect(i18n.langCode).toBe("ja");
    });

    it("should fallback to English for other languages", () => {
      const i18n = getI18n("es");
      expect(i18n.langCode).toBe("en");
    });
  });
});
