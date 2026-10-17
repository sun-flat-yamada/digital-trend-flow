/**
 * [Role] Prompt management: `prompts/` is the only place prompts are defined.
 * [Mechanism] `prompts/manifest.json` names the active file of each prompt, per output language
 * where the prompt has one. A missing manifest entry or file is an error (there is no inline
 * fallback). Every prompt a run loads is recorded in the run metrics as `<file>@<hash>`, so an
 * output can be traced back to the prompt that produced it.
 *
 * Items: 1.3 Prompt Versioning, Plan 2-1 batch triage prompt, Plan 2-5 (LLM-8)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PATHS } from "../core/paths";
import { metrics } from "../core/metrics";
import { isJapanese } from "../core/language";

/** A manifest entry: one file, or one file per language ("ja", "en"; "en" also serves other languages). */
type PromptEntry = string | Record<string, string>;

interface PromptManifest {
  active: Record<string, PromptEntry>;
  history: Array<{ version: string; activated_at: string; description: string }>;
}

/** Generates a short hash of a prompt for tracing. */
export function promptHash(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 8);
}

function isEnglish(language: string): boolean {
  return ["en", "english"].includes(language.toLowerCase());
}

function loadManifest(dir: string): PromptManifest {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Prompt manifest not found: ${manifestPath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PromptManifest;
}

/** The file of prompt `key` for `language`: the Japanese file for Japanese, the English one otherwise. */
function resolvePromptFile(manifest: PromptManifest, key: string, language: string): string {
  const entry = manifest.active[key];
  if (entry === undefined) {
    throw new Error(`Prompt "${key}" is not listed in prompts/manifest.json`);
  }
  if (typeof entry === "string") return entry;
  const file = isJapanese(language) ? entry["ja"] : entry["en"];
  if (!file) {
    throw new Error(`Prompt "${key}" has no ${isJapanese(language) ? "ja" : "en"} file in prompts/manifest.json`);
  }
  return file;
}

/**
 * Loads prompt `key` from `prompts/` and fills its `{{name}}` placeholders from `vars`.
 * Throws when the prompt, its file, or a value for one of its placeholders is missing.
 * The prompt is recorded in the run metrics as `<file>@<hash of the file>`.
 */
export function loadPrompt(
  key: string,
  language: string = "en",
  vars: Record<string, string> = {},
  dir: string = PATHS.PROMPTS,
): string {
  const file = resolvePromptFile(loadManifest(dir), key, language);
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${filePath} (prompt "${key}")`);
  }
  const template = fs.readFileSync(filePath, "utf8").trim();
  metrics.recordPrompt(key, `${file}@${promptHash(template)}`);

  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`Prompt file ${file} has a placeholder {{${name}}} with no value`);
    }
    return value;
  });
}

/** The writing-language rule of the English templates (`{{language_instruction}}`). */
function languageInstruction(language: string, document: string): string {
  return isEnglish(language)
    ? `Write the ${document} in fluent, professional, and natural English.`
    : `Write the entire ${document} in fluent, professional ${language}. Translate section headings and labels appropriately into ${language} while strictly adhering to the requested structure.`;
}

// ── Map Phase Prompt ──

export function getMapPrompt(): string {
  return loadPrompt("map");
}

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

// ── Batch Triage Prompt (Plan 2-1) ──

export function getTriagePrompt(): string {
  return loadPrompt("triage");
}

export const TRIAGE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "INTEGER", description: "Candidate id, unchanged" },
          relevance: { type: "INTEGER", description: "0-100 relevance to the purposes" },
          purpose: { type: "STRING", description: "Best-fitting purpose key, or none" },
          importance: { type: "INTEGER", description: "Importance 1-10" },
          duplicate_of: { type: "INTEGER", description: "Id of a candidate on the same story, or -1" },
        },
        required: ["id", "relevance", "purpose", "importance", "duplicate_of"],
      },
    },
  },
  required: ["items"],
};

// ── Reduce Phase Prompt ──

/**
 * Builds the daily Reduce prompt: the language's template (`reduce`) with one section per
 * purpose category found in today's articles.
 */
export function buildReducePrompt(
  activePurposes: { key: string; label: string }[],
  targetLanguage: string = "en",
): string {
  const ja = isJapanese(targetLanguage);
  const sourceLabel = ja ? "出典" : "Source";

  const purposeSections = activePurposes
    .map(
      (p) => `## ${p.label}

1. **[${ja ? "トレンドタイトル" : "Trend Title"}]**: [${ja ? "1-2文の分析" : "1-2 sentence analysis"}]
   **${sourceLabel}**: [Source Title](Source URL)
2. ...`,
    )
    .join("\n\n");

  return loadPrompt("reduce", targetLanguage, {
    purpose_sections: purposeSections,
    language_instruction: languageInstruction(targetLanguage, "briefing"),
  });
}

// ── Weekly / Monthly / Yearly Report Prompts ──

function periodicPrompt(key: string, language: string): string {
  return loadPrompt(key, language, { language_instruction: languageInstruction(language, "report") });
}

export function getWeeklyReducePrompt(language: string = "en"): string {
  return periodicPrompt("weekly_reduce", language);
}

export function getMonthlyReducePrompt(language: string = "en"): string {
  return periodicPrompt("monthly_reduce", language);
}

export function getYearlyReducePrompt(language: string = "en"): string {
  return periodicPrompt("yearly_reduce", language);
}
