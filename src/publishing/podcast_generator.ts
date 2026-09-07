/**
 * [Role] Automated 2-host conversational AI podcast & audio briefing generator.
 * [Mechanism] Converts daily summary markdown into a natural two-speaker dialogue
 * (Analyst & Engineer) and synthesizes audio via Edge-TTS (or graceful script fallback).
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { PATHS } from "../core/paths";

export interface DialogueTurn {
  speaker: "HostA" | "HostB";
  speakerName: string; // "ケンタ（解説）" | "アオイ（質問）"
  text: string;
}

export interface PodcastScript {
  title: string;
  date: string;
  turns: DialogueTurn[];
  markdown: string;
  estimatedDurationSec: number;
}

export interface PodcastGenerationResult {
  scriptPath: string;
  markdownPath: string;
  audioPath?: string | undefined;
  status: "synthesized" | "script_only";
}

/**
 * Extracts dialogue turns from daily summary markdown using heuristic synthesis.
 * This guarantees offline and fast execution without mandatory extra LLM roundtrips,
 * while maintaining natural conversational flow.
 */
export function buildDialogueScript(summaryMarkdown: string, date: string): PodcastScript {
  const turns: DialogueTurn[] = [];

  // Opening
  turns.push({
    speaker: "HostA",
    speakerName: "ケンタ",
    text: `みなさんこんにちは！デジタル・トレンド・フローへようこそ。アナリストのケンタです。`,
  });
  turns.push({
    speaker: "HostB",
    speakerName: "アオイ",
    text: `エンジニアのアオイです！本日${date}の最新テクノロジー動向をコンパクトにお届けします。ケンタさん、今日のトップニュースは何でしょうか？`,
  });

  // Extract Top News
  const topNewsMatch = summaryMarkdown.match(/## 🔥 本日の最重要ニュース\s+([\s\S]*?)(?=\n---|\n## )/);
  if (topNewsMatch?.[1]) {
    const topContent = topNewsMatch[1].trim();
    const titleMatch = topContent.match(/### ([^\n]+)/) ?? topContent.match(/\*\*\[([^\]]+)\]\*\*/);
    const topTitle = titleMatch?.[1] ?? "注目の最新トピック";

    turns.push({
      speaker: "HostA",
      speakerName: "ケンタ",
      text: `本日の最重要ニュースは、「${topTitle}」です。業界全体に大きなインパクトを与える動きとなっています。`,
    });

    // Check for technical breakthrough or details
    const breakthroughMatch = topContent.match(/🚀 技術的ブレークスルー[^:]*:\s*([^\n]+)/);
    if (breakthroughMatch?.[1]) {
      turns.push({
        speaker: "HostB",
        speakerName: "アオイ",
        text: `技術的なポイントや進歩はどこにあるんでしょうか？`,
      });
      turns.push({
        speaker: "HostA",
        speakerName: "ケンタ",
        text: `${breakthroughMatch[1]}という点が非常に注目されています。`,
      });
    }

    // Recommendation
    const actionMatch = topContent.match(/💡 エンジニアへの推奨アクション[^:]*:\s*([^\n]+)/);
    if (actionMatch?.[1]) {
      turns.push({
        speaker: "HostB",
        speakerName: "アオイ",
        text: `私たち開発者やエンジニアとしては、どう向き合うべきですか？`,
      });
      turns.push({
        speaker: "HostA",
        speakerName: "ケンタ",
        text: `推奨アクションとしては、${actionMatch[1]}とのことです。ぜひチェックしておきたいですね。`,
      });
    }
  }

  // Extract category highlights
  const categoryHeaders = Array.from(summaryMarkdown.matchAll(/## ([^\n🔥📰]+)/g))
    .map((m) => m[1]?.trim())
    .filter((h): h is string => Boolean(h && !h.includes("本日の最重要") && !h.includes("その他の関連")));

  if (categoryHeaders.length > 0) {
    turns.push({
      speaker: "HostB",
      speakerName: "アオイ",
      text: `他にはどのような分野で動きがありましたか？`,
    });
    const categoriesText = categoryHeaders.slice(0, 3).join("、そして");
    turns.push({
      speaker: "HostA",
      speakerName: "ケンタ",
      text: `本日は特に、${categoriesText}のカテゴリでも興味深い発表や論文が複数ありました。詳細は日次サマリーのノートにまとめています。`,
    });
  }

  // Ending
  turns.push({
    speaker: "HostB",
    speakerName: "アオイ",
    text: `気になった方はぜひリンク元の一次情報もあわせてご覧くださいね！`,
  });
  turns.push({
    speaker: "HostA",
    speakerName: "ケンタ",
    text: `それでは、また明日のデイリーブリーフィングでお会いしましょう。良い一日を！`,
  });

  // Calculate estimated duration (Japanese speech approx 350-400 chars per minute)
  const totalChars = turns.reduce((sum, t) => sum + t.text.length, 0);
  const estimatedDurationSec = Math.round((totalChars / 360) * 60);

  // Markdown representation
  const markdownLines = [
    `# 🎙️ デイリーAIポッドキャスト (${date})`,
    `**出演**: ケンタ（解説アナリスト）、アオイ（エンジニア） | **想定再生時間**: 約${Math.ceil(estimatedDurationSec / 60)}分\n`,
    "---",
    "",
    ...turns.map((t) => `**${t.speakerName}**: ${t.text}\n`),
  ];

  return {
    title: `Daily Audio Briefing (${date})`,
    date,
    turns,
    markdown: markdownLines.join("\n"),
    estimatedDurationSec,
  };
}

/**
 * Checks if edge-tts command-line tool is installed in the current environment.
 */
export function isEdgeTtsAvailable(): boolean {
  try {
    execSync("edge-tts --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates the dialogue script and attempts audio synthesis.
 */
export async function generatePodcast(
  summaryMarkdown: string,
  date: string,
  outputDir?: string
): Promise<PodcastGenerationResult> {
  const script = buildDialogueScript(summaryMarkdown, date);
  const [yyyy = "unknown", mm = "unknown"] = date.split("-");

  const targetDir =
    outputDir ??
    path.join(PATHS.ARTIFACTS_AUDIO.absolute, yyyy, mm);

  fs.mkdirSync(targetDir, { recursive: true });

  // 1. Save JSON dialogue script
  const jsonPath = path.join(targetDir, `${date}_podcast_script.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(script, null, 2), "utf8");

  // 2. Save Markdown dialogue script
  const mdPath = path.join(targetDir, `${date}_podcast_script.md`);
  fs.writeFileSync(mdPath, script.markdown, "utf8");

  console.log(`🎙️ Podcast script generated: ${mdPath}`);

  // 3. Audio Synthesis attempt
  const audioFileName = `${date}_podcast.mp3`;
  const audioPath = path.join(targetDir, audioFileName);

  if (isEdgeTtsAvailable()) {
    try {
      // Synthesize combined audio or host A voice
      const fullText = script.turns.map((t) => `${t.speakerName}。${t.text}`).join(" ");
      const escapedText = fullText.replace(/"/g, '\\"');
      execSync(`edge-tts --voice ja-JP-KeitaNeural --text "${escapedText}" --write-media "${audioPath}"`, {
        timeout: 60000,
      });
      console.log(`🔊 Podcast audio synthesized: ${audioPath}`);
      return {
        scriptPath: jsonPath,
        markdownPath: mdPath,
        audioPath,
        status: "synthesized",
      };
    } catch (e: any) {
      console.warn(`⚠️ Edge-TTS synthesis failed: ${e.message}. Saving script only.`);
    }
  }

  return {
    scriptPath: jsonPath,
    markdownPath: mdPath,
    status: "script_only",
  };
}
