import { buildReducePrompt } from "../src/summarization/prompts";
import { getI18n, I18N_EN, I18N_JA } from "../src/publishing/pages_generator";

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
