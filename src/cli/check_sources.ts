/**
 * [Role] Source reachability check (`npm run check:sources [URL ...]`).
 * [Mechanism] Fetches every source in config.yml once (disabled ones too, in their own section)
 * plus any feed URLs given as arguments, and reports status, item count and duration as a table on
 * stdout and in the GitHub Actions job summary. It neither reads nor writes pipeline_state.db and
 * calls no LLM or Jina. Exits 1 when an enabled source fails.
 */

import * as fs from "fs";
import { config } from "../core/config";
import { errorMessage } from "../core/errors";
import type { ArticleItem } from "../core/types";
import { fetchSource, type SourceWithPurpose } from "../ingestion/fetch_source";
import { sourceDisabledReason } from "../ingestion/source_availability";
import { disableStateLookups } from "../ingestion/state_manager";

export type CheckSection = "enabled" | "disabled" | "candidate";

export interface SourceCheckResult {
  section: CheckSection;
  name: string;
  type: string;
  /** "ok" (items returned), "empty" (reachable, no items), "error", or "skipped" (not checked). */
  status: "ok" | "empty" | "error" | "skipped";
  /** The error, or why the source was skipped (e.g. a missing API key). */
  detail?: string;
  count: number;
  durationMs: number;
}

const SECTION_TITLES: Record<CheckSection, string> = {
  enabled: "Enabled sources",
  disabled: "Disabled sources (enabled: false in config.yml)",
  candidate: "Candidate feeds (command-line arguments)",
};

/** Every configured source with its purpose, plus each extra URL as an RSS candidate. */
export function sourcesToCheck(
  purposes: typeof config.purposes,
  extraUrls: string[],
): { section: CheckSection; source: SourceWithPurpose }[] {
  const entries: { section: CheckSection; source: SourceWithPurpose }[] = [];
  for (const [purpose, def] of Object.entries(purposes)) {
    for (const source of def.sources ?? []) {
      entries.push({ section: source.enabled === false ? "disabled" : "enabled", source: { ...source, purpose } });
    }
  }
  for (const url of extraUrls) {
    entries.push({ section: "candidate", source: { type: "rss", name: url, url, enabled: true, purpose: "curated" } });
  }
  return entries;
}

/** Fetches each source once, one after another, and records the outcome. Never throws. */
export async function checkSources(
  entries: { section: CheckSection; source: SourceWithPurpose }[],
  fetcher: (source: SourceWithPurpose) => Promise<ArticleItem[]> = fetchSource,
): Promise<SourceCheckResult[]> {
  const results: SourceCheckResult[] = [];
  for (const { section, source } of entries) {
    const base = { section, name: source.name, type: source.type };
    // A disabled source is still checked; only a missing API key (or a module disabled in code) skips it.
    const skipReason = sourceDisabledReason({ ...source, enabled: true });
    if (skipReason !== null) {
      results.push({ ...base, status: "skipped", detail: skipReason, count: 0, durationMs: 0 });
      continue;
    }
    const started = Date.now();
    try {
      const items = await fetcher(source);
      const durationMs = Date.now() - started;
      results.push({ ...base, status: items.length > 0 ? "ok" : "empty", count: items.length, durationMs });
    } catch (error) {
      results.push({
        ...base,
        status: "error",
        detail: errorMessage(error),
        count: 0,
        durationMs: Date.now() - started,
      });
    }
  }
  return results;
}

const STATUS_LABELS: Record<SourceCheckResult["status"], string> = {
  ok: "✅ ok",
  empty: "⚪ empty",
  error: "❌ error",
  skipped: "⏸️ skipped",
};

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Formats the results as one Markdown table per section. */
export function formatReport(results: SourceCheckResult[]): string {
  const lines = ["## 🌐 Source reachability", ""];
  for (const section of Object.keys(SECTION_TITLES) as CheckSection[]) {
    const rows = results.filter((r) => r.section === section);
    if (rows.length === 0) continue;
    lines.push(`### ${SECTION_TITLES[section]}`, "");
    lines.push("| Source | Type | Status | Detail | Items | Time |", "|:---|:---|:---|:---|---:|---:|");
    for (const r of rows) {
      const time = r.status === "skipped" ? "-" : `${(r.durationMs / 1000).toFixed(1)}s`;
      lines.push(
        `| ${cell(r.name)} | ${r.type} | ${STATUS_LABELS[r.status]} | ${cell(r.detail ?? "")} | ${r.count} | ${time} |`,
      );
    }
    lines.push("");
  }
  const failed = results.filter((r) => r.section === "enabled" && r.status === "error").length;
  lines.push(failed > 0 ? `**${failed} enabled source(s) failed.**` : "All enabled sources are reachable.", "");
  return lines.join("\n");
}

/** 1 when an enabled source failed, else 0. Disabled sources and candidates never fail the check. */
export function exitCodeFor(results: SourceCheckResult[]): number {
  return results.some((r) => r.section === "enabled" && r.status === "error") ? 1 : 0;
}

async function main(): Promise<number> {
  disableStateLookups();
  const extraUrls = process.argv.slice(2).filter((arg) => arg.trim() !== "");
  const results = await checkSources(sourcesToCheck(config.purposes, extraUrls));
  const report = formatReport(results);
  console.log(`\n${report}`);
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath) fs.appendFileSync(summaryPath, `${report}\n`, "utf8");
  return exitCodeFor(results);
}

if (require.main === module) {
  void main().then((code) => process.exit(code));
}
