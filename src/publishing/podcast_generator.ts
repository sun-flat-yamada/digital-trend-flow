/**
 * [Role] Automated 2-host conversational AI podcast & audio briefing generator.
 * [Mechanism] Converts the daily summary into a two-speaker dialogue (analyst & engineer) and
 * synthesizes audio via Edge-TTS, one voice per host (script only when edge-tts is missing).
 * The script is built from the summary's structure (sections, headings, list items) rather than
 * from language-specific heading text, so it works for every output language; the spoken
 * phrases come from a per-language template (Japanese and English; other languages use English).
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { PATHS } from "../core/paths";
import { errorMessage } from "../core/errors";

export interface DialogueTurn {
  speaker: "HostA" | "HostB";
  speakerName: string;
  text: string;
}

export interface PodcastScript {
  title: string;
  date: string;
  language: string;
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

export interface PodcastVoices {
  host_a: string;
  host_b: string;
}

export interface PodcastOptions {
  outputDir?: string | undefined;
  language?: string | undefined;
  /** edge-tts voices keyed by language ("ja", "en", ...); "en" is used for unlisted languages. */
  voices?: Record<string, PodcastVoices> | undefined;
}

export const DEFAULT_VOICES: Record<string, PodcastVoices> = {
  ja: { host_a: "ja-JP-KeitaNeural", host_b: "ja-JP-NanamiNeural" },
  en: { host_a: "en-US-GuyNeural", host_b: "en-US-JennyNeural" },
};

// ── Summary structure ──

export interface SummaryStructure {
  topStory?: { title: string; paragraphs: string[]; points: string[] } | undefined;
  categories: { label: string; items: { title: string; detail: string }[] }[];
}

/** Removes Markdown syntax (links, emphasis, code, wikilinks) so the text can be spoken. */
export function toSpokenText(markdown: string): string {
  return markdown
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => label ?? target)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*|__|~~/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first `count` sentences of a text (Japanese or Latin sentence ends). */
function firstSentences(text: string, count: number): string {
  const sentences = text.match(/[^。.!?！？]+[。.!?！？]?/g) ?? [text];
  return sentences.slice(0, count).join("").trim();
}

/** A citation line such as "**Source**: [..](..) | **Category**: ..." carries nothing to say. */
function isMetaLine(line: string): boolean {
  return /^\*\*[^*]+\*\*\s*[:：]\s*\[/.test(line) || /\|\s*\*\*[^*]+\*\*\s*[:：]/.test(line);
}

/**
 * Parses the Reduce output: the first `##` section (or the one marked 🔥) is the top story, with
 * its `###` headline, prose paragraphs and bullet points; the other `##` sections are categories
 * with their numbered items. The last section, when it is a plain link list, is ignored.
 */
export function parseSummaryStructure(markdown: string): SummaryStructure {
  const sections: { heading: string; lines: string[] }[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^##\s+(.+)$/);
    if (heading?.[1]) {
      sections.push({ heading: heading[1].trim(), lines: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1]!.lines.push(line);
    }
  }
  if (sections.length === 0) return { categories: [] };

  const topIndex = Math.max(
    0,
    sections.findIndex((s) => s.heading.includes("🔥")),
  );
  const top = sections[topIndex]!;
  const titleLine = top.lines.find((l) => /^###\s+/.test(l));
  const paragraphs = top.lines
    .filter((l) => l !== "" && !/^(#{1,6}\s|[-*]\s|\d+\.\s|---|>)/.test(l) && !isMetaLine(l))
    .map(toSpokenText)
    .filter((l) => l.length > 0);
  const points = top.lines
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => toSpokenText(l.replace(/^[-*]\s+/, "").replace(/^\*\*[^*]+\*\*\s*[:：]\s*/, "")))
    .filter((l) => l.length > 0);

  const categories: SummaryStructure["categories"] = [];
  sections.forEach((section, i) => {
    if (i === topIndex) return;
    const items = section.lines
      .map((l) => l.match(/^\d+\.\s+\*\*(.+?)\*\*\s*[:：]?\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ title: toSpokenText(m[1] ?? ""), detail: toSpokenText(m[2] ?? "") }));
    if (items.length > 0) categories.push({ label: toSpokenText(section.heading), items });
  });

  return {
    topStory: titleLine
      ? { title: toSpokenText(titleLine.replace(/^###\s+/, "")), paragraphs, points }
      : paragraphs.length > 0 || points.length > 0
        ? { title: toSpokenText(top.heading), paragraphs, points }
        : undefined,
    categories,
  };
}

// ── Language templates ──

interface PodcastTemplate {
  hostA: string;
  hostB: string;
  heading: (date: string) => string;
  cast: (minutes: number) => string;
  greetingA: string;
  greetingB: (date: string) => string;
  topStory: (title: string) => string;
  pointQuestions: string[];
  categoryQuestion: (label: string) => string;
  categoryAnswer: (title: string, detail: string) => string;
  otherQuestion: string;
  closingB: string;
  closingA: string;
  /** Characters (ja) or words (en) spoken per minute */
  perMinute: (text: string) => number;
}

const TEMPLATES: Record<"ja" | "en", PodcastTemplate> = {
  ja: {
    hostA: "ケンタ",
    hostB: "アオイ",
    heading: (date) => `# 🎙️ デイリーAIポッドキャスト (${date})`,
    cast: (minutes) => `**出演**: ケンタ（解説アナリスト）、アオイ（エンジニア） | **想定再生時間**: 約${minutes}分\n`,
    greetingA: "みなさんこんにちは！デジタル・トレンド・フローへようこそ。アナリストのケンタです。",
    greetingB: (date) =>
      `エンジニアのアオイです！本日${date}の最新テクノロジー動向をコンパクトにお届けします。ケンタさん、今日のトップニュースは何でしょうか？`,
    topStory: (title) => `本日の最重要ニュースは、「${title}」です。`,
    pointQuestions: [
      "技術的なポイントや進歩はどこにあるんでしょうか？",
      "導入するうえで気をつけることはありますか？",
      "私たち開発者やエンジニアとしては、どう向き合うべきですか？",
    ],
    categoryQuestion: (label) => `${label}の分野ではどんな動きがありましたか？`,
    categoryAnswer: (title, detail) => (detail ? `「${title}」です。${detail}` : `「${title}」が注目です。`),
    otherQuestion: "ほかにはどうですか？",
    closingB: "気になった方はぜひリンク元の一次情報もあわせてご覧くださいね！",
    closingA: "それでは、また明日のデイリーブリーフィングでお会いしましょう。良い一日を！",
    perMinute: (text) => text.length / 360,
  },
  en: {
    hostA: "Ken",
    hostB: "Aoi",
    heading: (date) => `# 🎙️ Daily AI Podcast (${date})`,
    cast: (minutes) => `**Hosts**: Ken (analyst), Aoi (engineer) | **Estimated length**: about ${minutes} min\n`,
    greetingA: "Hello everyone, and welcome to Digital Trend Flow. I'm Ken, your analyst.",
    greetingB: (date) =>
      `And I'm Aoi, an engineer. Here is your compact tech briefing for ${date}. Ken, what's the top story today?`,
    topStory: (title) => `Today's top story is "${title}".`,
    pointQuestions: [
      "What is the technical advance here?",
      "What should teams watch out for before adopting it?",
      "So what should engineers do about it?",
    ],
    categoryQuestion: (label) => `What happened in ${label}?`,
    categoryAnswer: (title, detail) => (detail ? `"${title}". ${detail}` : `"${title}" stood out.`),
    otherQuestion: "Anything else?",
    closingB: "If something caught your interest, check the original sources linked in the summary.",
    closingA: "That's it for today. See you at tomorrow's daily briefing!",
    perMinute: (text) => text.split(/\s+/).filter(Boolean).length / 150,
  },
};

function templateKey(language: string): "ja" | "en" {
  const lang = language.toLowerCase();
  return lang === "ja" || lang === "japanese" || lang.startsWith("ja-") ? "ja" : "en";
}

/**
 * Builds the two-host dialogue from the daily summary. Offline and deterministic: no extra LLM
 * call is made.
 */
export function buildDialogueScript(summaryMarkdown: string, date: string, language: string = "ja"): PodcastScript {
  const t = TEMPLATES[templateKey(language)];
  const turns: DialogueTurn[] = [];
  const a = (text: string) => turns.push({ speaker: "HostA", speakerName: t.hostA, text });
  const b = (text: string) => turns.push({ speaker: "HostB", speakerName: t.hostB, text });

  a(t.greetingA);
  b(t.greetingB(date));

  const structure = parseSummaryStructure(summaryMarkdown);
  if (structure.topStory) {
    const intro = structure.topStory.paragraphs[0];
    a(`${t.topStory(structure.topStory.title)}${intro ? ` ${firstSentences(intro, 2)}` : ""}`.trim());
    structure.topStory.points.slice(0, t.pointQuestions.length).forEach((point, i) => {
      b(t.pointQuestions[i]!);
      a(firstSentences(point, 2));
    });
  }

  structure.categories.slice(0, 3).forEach((category, i) => {
    const item = category.items[0]!;
    b(i === 0 ? t.categoryQuestion(category.label) : `${t.otherQuestion} ${t.categoryQuestion(category.label)}`);
    a(t.categoryAnswer(item.title, firstSentences(item.detail, 2)));
  });

  b(t.closingB);
  a(t.closingA);

  const estimatedDurationSec = Math.round(t.perMinute(turns.map((turn) => turn.text).join(" ")) * 60);

  const markdown = [
    t.heading(date),
    t.cast(Math.max(1, Math.ceil(estimatedDurationSec / 60))),
    "---",
    "",
    ...turns.map((turn) => `**${turn.speakerName}**: ${turn.text}\n`),
  ].join("\n");

  return {
    title: `Daily Audio Briefing (${date})`,
    date,
    language: templateKey(language),
    turns,
    markdown,
    estimatedDurationSec,
  };
}

/**
 * Checks if edge-tts command-line tool is installed in the current environment.
 */
export function isEdgeTtsAvailable(): boolean {
  try {
    execFileSync("edge-tts", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Synthesizes each turn with its host's voice and joins the MP3 segments (MP3 frames can be
 * concatenated). The text derives from LLM output over scraped articles, so it is passed as a
 * plain argument without a shell: `$(...)`, backticks and quotes are never interpreted.
 */
function synthesizeAudio(script: PodcastScript, voices: PodcastVoices, audioPath: string): void {
  const partsDir = `${audioPath}.parts`;
  fs.mkdirSync(partsDir, { recursive: true });
  try {
    const segments = script.turns.map((turn, i) => {
      const segmentPath = path.join(partsDir, `${String(i).padStart(3, "0")}.mp3`);
      execFileSync(
        "edge-tts",
        [
          "--voice",
          turn.speaker === "HostA" ? voices.host_a : voices.host_b,
          "--text",
          turn.text,
          "--write-media",
          segmentPath,
        ],
        { timeout: 60000, stdio: "ignore" },
      );
      return fs.readFileSync(segmentPath);
    });
    fs.writeFileSync(audioPath, Buffer.concat(segments));
  } finally {
    fs.rmSync(partsDir, { recursive: true, force: true });
  }
}

/**
 * Generates the dialogue script and attempts audio synthesis.
 */
export async function generatePodcast(
  summaryMarkdown: string,
  date: string,
  options: PodcastOptions = {},
): Promise<PodcastGenerationResult> {
  const script = buildDialogueScript(summaryMarkdown, date, options.language ?? "ja");
  const [yyyy = "unknown", mm = "unknown"] = date.split("-");

  const targetDir = options.outputDir ?? path.join(PATHS.ARTIFACTS_AUDIO.absolute, yyyy, mm);
  fs.mkdirSync(targetDir, { recursive: true });

  // 1. Save JSON dialogue script
  const jsonPath = path.join(targetDir, `${date}_podcast_script.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(script, null, 2), "utf8");

  // 2. Save Markdown dialogue script
  const mdPath = path.join(targetDir, `${date}_podcast_script.md`);
  fs.writeFileSync(mdPath, script.markdown, "utf8");

  console.log(`🎙️ Podcast script generated: ${mdPath}`);

  // 3. Audio synthesis
  const audioPath = path.join(targetDir, `${date}_podcast.mp3`);
  if (!isEdgeTtsAvailable()) {
    console.log("ℹ️ edge-tts is not installed; podcast audio skipped (install with `pip install edge-tts`).");
    return { scriptPath: jsonPath, markdownPath: mdPath, status: "script_only" };
  }

  const voiceTable = options.voices ?? DEFAULT_VOICES;
  const voices = voiceTable[script.language] ?? voiceTable["en"] ?? DEFAULT_VOICES[script.language]!;
  try {
    synthesizeAudio(script, voices, audioPath);
    console.log(`🔊 Podcast audio synthesized: ${audioPath}`);
    return { scriptPath: jsonPath, markdownPath: mdPath, audioPath, status: "synthesized" };
  } catch (e) {
    fs.rmSync(audioPath, { force: true });
    console.warn(`⚠️ Edge-TTS synthesis failed: ${errorMessage(e)}. Saving script only.`);
    return { scriptPath: jsonPath, markdownPath: mdPath, status: "script_only" };
  }
}
