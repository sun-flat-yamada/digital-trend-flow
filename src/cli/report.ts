/**
 * [Role] CLI for the periodic reports (weekly / monthly / yearly).
 * [Mechanism] Generates the report for the given period (default: the previous complete one),
 * then publishes it through the plugin registry (notifiers, Zenn, note.com), with a Langfuse trace.
 * Exit code: 0 on success or when the period has no data, 1 on failure.
 *
 * Usage:
 *   node dist/cli/report.js weekly  [2026-W42 | 2026-10-17]
 *   node dist/cli/report.js monthly [2026-09]
 *   node dist/cli/report.js yearly  [2026]
 */

import { randomUUID } from "crypto";
import { generateWeeklyDigest, getIsoWeekString } from "../aggregation/weekly_digest";
import { generateMonthlyDigest } from "../aggregation/monthly_digest";
import { generateYearlyReport } from "../aggregation/yearly_report";
import { type PeriodicReport } from "../aggregation/periodic_common";
import { registerBuiltinPlugins } from "../core/builtin_plugins";
import { initLangfuse, createTrace, flushLangfuse } from "../core/langfuse";
import { metrics } from "../core/metrics";
import { closeDb } from "../ingestion/state_manager";
import { errorMessage } from "../core/errors";

export type PeriodicKind = PeriodicReport["kind"];

const DAY_MS = 86_400_000;

/** The previous complete period at `now` (UTC): last ISO week, last month or last year. */
export function defaultPeriod(kind: PeriodicKind, now: Date = new Date()): string {
  switch (kind) {
    case "weekly":
      return getIsoWeekString(new Date(now.getTime() - 7 * DAY_MS));
    case "monthly": {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    case "yearly":
      return String(now.getUTCFullYear() - 1);
  }
}

export function generateReport(kind: PeriodicKind, period: string): Promise<PeriodicReport | null> {
  switch (kind) {
    case "weekly":
      return generateWeeklyDigest(period);
    case "monthly":
      return generateMonthlyDigest(period);
    case "yearly":
      return generateYearlyReport(period);
  }
}

/** Generates and publishes one report. Resolves with the report, or null when there was no data. */
export async function runReport(kind: PeriodicKind, period: string): Promise<PeriodicReport | null> {
  const registry = registerBuiltinPlugins();
  initLangfuse();
  createTrace(randomUUID(), period, `${kind}-report-${period}`);

  const report = await generateReport(kind, period);
  if (!report) return null;

  const results = await registry.publishAll({
    kind: report.kind,
    title: report.title,
    markdown: report.markdown,
    articleCount: report.articleCount,
    date: report.endDate,
    period: report.period,
    language: report.language,
    tags: report.tags,
  });
  for (const r of results) {
    console.log(`  📣 ${r.name}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
  }

  const snapshot = metrics.getSnapshot();
  console.log(
    `💰 LLM cost: $${snapshot.total_cost_usd.toFixed(4)} (${snapshot.total_tokens.input.toLocaleString()} in / ${snapshot.total_tokens.output.toLocaleString()} out)`,
  );
  return report;
}

function isKind(value: string | undefined): value is PeriodicKind {
  return value === "weekly" || value === "monthly" || value === "yearly";
}

async function cli(argv: string[]): Promise<number> {
  const [kind, periodArg] = argv;
  if (!isKind(kind)) {
    console.error("Usage: report <weekly|monthly|yearly> [period]");
    return 1;
  }
  const period = periodArg || defaultPeriod(kind);
  console.log(`🚀 Generating the ${kind} report for ${period}...`);
  try {
    const report = await runReport(kind, period);
    if (!report) console.log(`ℹ️ No data for ${period}; nothing was generated.`);
    return 0;
  } catch (error) {
    console.error(`💀 ${kind} report failed: ${errorMessage(error)}`);
    return 1;
  } finally {
    await flushLangfuse();
    try {
      closeDb();
    } catch {
      // Non-fatal
    }
  }
}

if (require.main === module) {
  void cli(process.argv.slice(2)).then((code) => process.exit(code));
}
