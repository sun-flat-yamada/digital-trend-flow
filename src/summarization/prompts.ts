/**
 * [Role] Prompt management with versioning and external file support.
 * [Mechanism] Loads prompts from external files if available, falls back
 * to inline defaults. Tracks prompt versions via manifest.json.
 *
 * Items: 1.3 Prompt Versioning, 3.1 LLM-as-Judge prompt
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../core/paths";
import * as crypto from "crypto";

const PROMPTS_DIR = PATHS.PROMPTS;
const MANIFEST_PATH = path.join(PROMPTS_DIR, "manifest.json");

interface PromptManifest {
  active: Record<string, string>;
  history: Array<{ version: string; activated_at: string; description: string }>;
}

/** Loads the prompt manifest, if it exists. */
function loadManifest(): PromptManifest | null {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as PromptManifest;
    }
  } catch {
    // Ignore manifest errors, use inline defaults
  }
  return null;
}

/** Loads a prompt from an external file, returning null if not found. */
function loadPromptFile(filename: string): string | null {
  try {
    const filePath = path.join(PROMPTS_DIR, filename);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8").trim();
    }
  } catch {
    // Fall through to inline default
  }
  return null;
}

/** Generates a short hash of a prompt for tracing. */
export function promptHash(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 8);
}

// ── Map Phase Prompt ──

const INLINE_MAP_PROMPT = `You are a fact extraction assistant.
Given an article's title, URL, and body text, extract the key facts.

Rules:
- Output ONLY valid JSON. No markdown fences, no explanation.
- Each fact must be under 150 characters.
- Preserve the original article title and URL verbatim as citation.
- Extract between 1 and 5 facts. If the content is too short or low quality, extract fewer.
- Rate importance from 1 (low) to 10 (high).
- Focus on concrete data points, announcements, metrics, and technical breakthroughs.
- Ignore promotional language, boilerplate, and navigation text.

Output JSON schema:
{
  "source_title": "string",
  "source_url": "string",
  "facts": [
    { "text": "fact string under 150 chars", "importance": number_1_to_10 }
  ]
}`;

export function getMapPrompt(): string {
  const manifest = loadManifest();
  if (manifest?.active?.["map"]) {
    const loaded = loadPromptFile(manifest.active["map"]);
    if (loaded) return loaded;
  }
  return INLINE_MAP_PROMPT;
}

// Keep legacy export for backward compatibility
export const MAP_SYSTEM_PROMPT = INLINE_MAP_PROMPT;

// ── Structured Output Schema for Map (Item 1.1) ──

export const MAP_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    source_title: { type: "STRING", description: "Original article title" },
    source_url: { type: "STRING", description: "Original article URL" },
    facts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING", description: "Concise fact under 150 chars" },
          importance: { type: "INTEGER", description: "Importance 1-10" },
        },
        required: ["text", "importance"],
      },
    },
  },
  required: ["source_title", "source_url", "facts"],
};

// ── LLM-as-Judge Prompt (Item 3.1) ──

const INLINE_JUDGE_PROMPT = `You are a relevance judge for a technology news curation pipeline.
Given an article's title and a brief excerpt, evaluate its relevance and importance.

Rules:
- Output ONLY valid JSON. No markdown fences, no explanation.
- Score relevance from 0 (irrelevant) to 100 (critical).
- Suggest the best category from the provided list.
- Provide a brief reasoning (1 sentence).

Output JSON schema:
{
  "relevance_score": number_0_to_100,
  "category_suggestion": "string",
  "reasoning": "string",
  "is_breaking_news": boolean,
  "topics": ["string"]
}`;

export function getJudgePrompt(): string {
  const manifest = loadManifest();
  if (manifest?.active?.["judge"]) {
    const loaded = loadPromptFile(manifest.active["judge"]);
    if (loaded) return loaded;
  }
  return INLINE_JUDGE_PROMPT;
}

export const JUDGE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    relevance_score: { type: "INTEGER", description: "0-100 relevance score" },
    category_suggestion: { type: "STRING", description: "Best matching category" },
    reasoning: { type: "STRING", description: "One sentence reasoning" },
    is_breaking_news: { type: "BOOLEAN", description: "Is this breaking news" },
    topics: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Key topics mentioned",
    },
  },
  required: ["relevance_score", "category_suggestion", "reasoning", "is_breaking_news", "topics"],
};

// ── Reduce Phase Prompt (Dynamic) ──

/**
 * Builds a purpose-aware Reduce prompt dynamically based on the active
 * purpose categories found in today's articles and the target output language.
 */
export function buildReducePrompt(
  activePurposes: { key: string; label: string }[],
  targetLanguage: string = "en"
): string {
  const isJa = targetLanguage.toLowerCase() === "ja" || targetLanguage.toLowerCase() === "japanese";
  const sourceLabel = isJa ? "出典" : "Source";

  const purposeSections = activePurposes
    .map(
      (p) => `## ${p.label}

1. **[${isJa ? "トレンドタイトル" : "Trend Title"}]**: [${isJa ? "1-2文の分析" : "1-2 sentence analysis"}]
   **${sourceLabel}**: [Source Title](Source URL)
2. ...`
    )
    .join("\n\n");

  if (isJa) {
    return `あなたは、テクノロジー業界に精通した上級アナリストです。
読者は技術リーダー・エンジニアリングマネージャーであり、意思決定に直結する情報を求めています。

入力として、複数記事から抽出されたファクトの JSON 配列を受け取ります。
各ファクトには "category"（カテゴリラベル）と "pipeline_score"（パイプラインのスコア）が含まれます。

**出力フォーマット（厳守）:**

## 🔥 本日の最重要ニュース

### [タイトル]
**出典**: [Source Title](Source URL) | **カテゴリ**: [Purpose Label]

[全カテゴリ横断で最も重要度・影響度の高い1件の分析。pipeline_score が最高のファクトを第一候補とし、
直接的なビジネスインパクト・技術的ブレークスルー・業界構造変化の観点から選定すること。
なぜ重要か？ 今後どのような影響があるか？ を2-3段落で分析する。]

- **🚀 技術的ブレークスルー / 定量進歩**: [定量的な性能向上、新規性、アーキテクチャやアルゴリズムの進歩を具体的に記述]
- **⚠️ 採用・導入のトレードオフ**: [計算資源、推論コスト、ライセンス制限、既存技術スタックへの影響など]
- **💡 エンジニアへの推奨アクション**: [「今すぐPoC/検証すべき」「ドキュメント確認」「様子見」などの具体的アクション]

---

${purposeSections}

## 📰 その他の関連ニュース

- [Article Title](Source URL) — [Purpose Label]
- ...

**ルール:**
1. すべての項目に出典（出典）をクリック可能なリンクで含めること。
2. 🔥 トップニュースには洞察のある分析と、上記の「技術的ブレークスルー」「採用・導入のトレードオフ」「エンジニアへの推奨アクション」を必ず含めること。
3. 各カテゴリセクションには1-3項目を含めること。
4. ファクトが存在しないカテゴリは、セクションを完全に省略すること。
5. 全体を3,000〜5,000文字で収めること。
6. 日本語で執筆すること。ただし、技術用語（transformer, fine-tuning, LLM 等）は原語のまま使用してよい。
7. 翻訳調ではなく、自然で読みやすい日本語で書くこと。
8. カテゴリは上記の順序を守ること。`;
  }

  const isEn = targetLanguage.toLowerCase() === "en" || targetLanguage.toLowerCase() === "english";
  const languageInstruction = isEn
    ? "Write the briefing in fluent, professional, and natural English."
    : `Write the entire briefing in fluent, professional ${targetLanguage}. Translate section headings and labels appropriately into ${targetLanguage} while strictly adhering to the requested structure.`;

  return `You are a senior technology industry analyst.
Your readers are engineering leaders, CTOs, and technical managers who require actionable, high-signal intelligence for strategic decision-making.

You will receive a JSON array of extracted facts from multiple articles as input.
Each fact contains "category" (category label) and "pipeline_score" (the pipeline's relevance score).

**Output Format (Strict Compliance Required):**

## 🔥 Today's Top Story

### [Title]
**Source**: [Source Title](Source URL) | **Category**: [Purpose Label]

[In-depth analysis of the single most critical and impactful story across all categories. Treat the highest pipeline_score fact as the prime candidate. Evaluate in terms of direct business impact, technical breakthroughs, and industry shifts. Explain why it matters and what ripple effects it will create in 2-3 paragraphs.]

- **🚀 Technical Breakthrough / Quantitative Advance**: [Specific quantitative improvements, novelty, architectural or algorithmic innovations]
- **⚠️ Trade-offs & Adoption Considerations**: [Compute requirements, inference costs, licensing, backward compatibility, impact on existing tech stacks]
- **💡 Recommended Actions for Engineers**: [Concrete guidance: "Start PoC immediately", "Review documentation", "Wait-and-see", etc.]

---

${purposeSections}

## 📰 Other Relevant News

- [Article Title](Source URL) — [Purpose Label]
- ...

**Rules:**
1. Always include clickable markdown citation links for all sources (**Source**: [Title](URL)).
2. The 🔥 Top Story must include deep analytical insight and the three mandatory bullet points: Technical Breakthrough, Trade-offs & Adoption Considerations, and Recommended Actions for Engineers.
3. Include 1-3 items per active category section.
4. Completely omit any category section that has no corresponding facts.
5. Target length: roughly 800 to 1,500 words (or 3,000-6,000 characters).
6. ${languageInstruction}
7. Maintain the exact order of categories as listed above.`;
}

// Legacy export (default English)
export const REDUCE_SYSTEM_PROMPT = buildReducePrompt([
  { key: "ai_research", label: "🔬 AI・LLM 研究" },
  { key: "ai_dev_tools", label: "🛠️ 開発ツール・IDE統合" },
  { key: "business", label: "💼 ビジネス動向" },
  { key: "geopolitics", label: "🌍 政治・地政学" },
], "en");

// ── Monthly Digest Prompt (Item 6.1) ──

const INLINE_MONTHLY_PROMPT = `あなたはテクノロジー業界のトレンドを分析するアナリストです。
過去の日次サマリーからファクトを受け取り、月次のトレンドダイジェストを生成します。

**出力フォーマット（厳守）:**

## 📈 今月のトレンド概要
[今月全体を通じた最も重要なトレンドの要約。3-4段落で分析する。]

## 🔥 月間トップ5ニュース
1. **[トレンドタイトル]**: [分析] — **出典**: [Source](URL) | [日付]

## 📊 カテゴリ別分析
### [カテゴリ名]
[このカテゴリの月間トレンド分析。1-2段落。]

## 🔮 来月の注目ポイント
- [予測1]

**ルール:**
1. すべての項目に出典リンクを含めること。
2. 時系列の変化に注目すること。
3. 日本語で執筆。技術用語は原語のまま。
4. 全体を5,000〜10,000文字で収めること。`;

export function getMonthlyReducePrompt(): string {
  const manifest = loadManifest();
  if (manifest?.active?.["monthly_reduce"]) {
    const loaded = loadPromptFile(manifest.active["monthly_reduce"]);
    if (loaded) return loaded;
  }
  return INLINE_MONTHLY_PROMPT;
}
