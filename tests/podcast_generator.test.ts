/**
 * Unit tests for Podcast dialogue and audio briefing generator.
 */

import * as fs from "fs";
import * as path from "path";
import { buildDialogueScript, generatePodcast } from "../src/publishing/podcast_generator";

describe("podcast_generator", () => {
  const tmpDir = path.join(process.cwd(), "_tmp_ai", "test_podcast");

  const sampleSummary = `## 🔥 本日の最重要ニュース

### OpenAIが次世代推論モデル「o3」を発表
**出典**: [OpenAI](https://openai.com) | **カテゴリ**: 🔬 AI・LLM 研究

業界に激震をもたらす推論モデルが登場しました。

- **🚀 技術的ブレークスルー**: ARC-AGIベンチマークで人間レベルの87.5%を達成
- **⚠️ 採用・導入のトレードオフ**: 推論時間とトークンコストの増大
- **💡 エンジニアへの推奨アクション**: 複雑タスクから試験導入を推奨

---

## 🔬 AI・LLM 研究
1. **DeepSeek-V3**: MoEアーキテクチャの革新

## 🛠️ 開発ツール・IDE統合
1. **Cursor新機能**: エージェント機能の強化
`;

  afterAll(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Cleanup
    }
  });

  test("builds structured two-host dialogue script", () => {
    const script = buildDialogueScript(sampleSummary, "2026-09-07");

    expect(script.turns.length).toBeGreaterThanOrEqual(6);
    expect(script.date).toBe("2026-09-07");
    expect(script.estimatedDurationSec).toBeGreaterThan(10);

    // Verify hosts
    const hostATurns = script.turns.filter((t) => t.speaker === "HostA");
    const hostBTurns = script.turns.filter((t) => t.speaker === "HostB");
    expect(hostATurns.length).toBeGreaterThan(0);
    expect(hostBTurns.length).toBeGreaterThan(0);

    // Verify top story captured
    const combinedText = script.turns.map((t) => t.text).join(" ");
    expect(combinedText).toContain("OpenAIが次世代推論モデル");
    expect(combinedText).toContain("ARC-AGI");
    expect(combinedText).toContain("試験導入");
  });

  test("generates podcast files in script_only mode when TTS is absent", async () => {
    const result = await generatePodcast(sampleSummary, "2026-09-07", tmpDir);

    expect(fs.existsSync(result.scriptPath)).toBe(true);
    expect(fs.existsSync(result.markdownPath)).toBe(true);

    const scriptJson = JSON.parse(fs.readFileSync(result.scriptPath, "utf8"));
    expect(scriptJson.turns).toBeInstanceOf(Array);
    expect(result.status).toBeDefined();
  });
});
