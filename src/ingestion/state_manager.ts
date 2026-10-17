/**
 * [Role] Manages pipeline state via SQLite for idempotent processing.
 * [Mechanism] Uses better-sqlite3 for synchronous, high-performance state
 * management with TTL-based automatic cleanup and pipeline run statistics.
 *
 * Items: 5.1 SQLite 移行, 5.2 TTL 実装, 5.3 処理統計永続化
 *
 * Schema migrations: `PRAGMA user_version` records the schema version, and getDb() applies the
 * missing steps of MIGRATIONS in order, each in its own transaction. A DB created before
 * versioning (user_version 0) already has the version 1 tables, which are created IF NOT EXISTS.
 *
 * Migration from processed_urls.json:
 * - On first run, if processed_urls.json exists, its data is imported
 *   into the SQLite DB and the JSON file is renamed to .bak.
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import { config } from "../core/config";
import type { PipelineRunMetrics } from "../core/metrics";
import { PATHS, stateDbPath } from "../core/paths";
import { normalizeUrl } from "../core/url";
import { errorMessage } from "../core/errors";

const LEGACY_JSON_PATH = PATHS.LEGACY_JSON;
const DEFAULT_TTL_DAYS = 90;

// ── Database Initialization ──

let db: Database.Database | null = null;

/** Schema steps; MIGRATIONS[n] brings a DB from version n to n + 1. */
const MIGRATIONS: ReadonlyArray<(database: Database.Database) => void> = [
  // 1: processed URLs, run records and source health
  (database) =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS processed_urls (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      purpose TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+${DEFAULT_TTL_DAYS} days'))
    );

    CREATE INDEX IF NOT EXISTS idx_processed_urls_expires
      ON processed_urls(expires_at);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      run_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      articles_ingested INTEGER NOT NULL DEFAULT 0,
      articles_scored INTEGER NOT NULL DEFAULT 0,
      articles_selected INTEGER NOT NULL DEFAULT 0,
      articles_by_purpose TEXT, -- JSON
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      quality_score REAL,
      metrics_json TEXT -- Full metrics JSON for detailed analysis
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_date
      ON pipeline_runs(date);

    CREATE TABLE IF NOT EXISTS source_health (
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      check_date TEXT NOT NULL,
      status TEXT NOT NULL, -- 'ok' | 'empty' | 'error' | 'disabled'
      article_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      PRIMARY KEY (source_name, check_date)
    );

    CREATE INDEX IF NOT EXISTS idx_source_health_date
      ON source_health(check_date);
  `),
  // 2: articles that were evaluated but not summarized, kept briefly so they are not re-fetched
  (database) =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS evaluated_urls (
      url TEXT PRIMARY KEY,
      outcome TEXT NOT NULL, -- 'below_threshold' | 'excluded' | 'not_selected'
      score REAL NOT NULL DEFAULT 0,
      purpose TEXT,
      evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evaluated_urls_expires
      ON evaluated_urls(expires_at);
  `),
  // 3: the run outcome as columns (it was only inside metrics_json), backfilled from metrics_json
  (database) =>
    database.exec(`
    ALTER TABLE pipeline_runs ADD COLUMN run_status TEXT; -- 'success' | 'degraded' | 'skipped' | 'failed'
    ALTER TABLE pipeline_runs ADD COLUMN status_reasons TEXT; -- JSON array
    UPDATE pipeline_runs
      SET run_status = json_extract(metrics_json, '$.run_status'),
          status_reasons = json_extract(metrics_json, '$.status_reasons')
      WHERE json_valid(metrics_json);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status
      ON pipeline_runs(run_status);
  `),
];

/** The schema version this code writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(database: Database.Database): void {
  const current = database.pragma("user_version", { simple: true }) as number;
  if (current > SCHEMA_VERSION) {
    throw new Error(`State DB schema version ${current} is newer than this code supports (${SCHEMA_VERSION})`);
  }
  for (let version = current; version < SCHEMA_VERSION; version++) {
    database.transaction(() => {
      MIGRATIONS[version]?.(database);
      database.pragma(`user_version = ${version + 1}`);
    })();
  }
  if (current < SCHEMA_VERSION) console.log(`🗄️ State DB schema migrated: version ${current} → ${SCHEMA_VERSION}`);
}

function getDb(): Database.Database {
  if (db) return db;

  const opened = new Database(stateDbPath());
  try {
    opened.pragma("journal_mode = WAL"); // Write-Ahead Logging for better concurrency
    opened.pragma("foreign_keys = ON");
    migrate(opened);
  } catch (error) {
    opened.close(); // so the next call retries instead of using an unmigrated DB
    throw error;
  }
  db = opened;

  // Migrate from legacy JSON if it exists
  migrateLegacyJson();

  // Purge expired entries on startup
  purgeExpired();

  return db;
}

/** The schema version of the open state DB (opening it, and so migrating it, if needed). */
export function getSchemaVersion(): number {
  return getDb().pragma("user_version", { simple: true }) as number;
}

// ── Legacy Migration ──

interface LegacyRecord {
  title: string;
  processed_at: string;
  score: number;
}

function migrateLegacyJson(): void {
  if (!fs.existsSync(LEGACY_JSON_PATH)) return;

  try {
    const raw = fs.readFileSync(LEGACY_JSON_PATH, "utf8");
    const data: Record<string, LegacyRecord> = JSON.parse(raw);
    const entries = Object.entries(data);

    if (entries.length === 0) return;

    const database = getDb();
    const insert = database.prepare(`
      INSERT OR IGNORE INTO processed_urls (url, title, score, processed_at, expires_at)
      VALUES (?, ?, ?, ?, datetime(?, '+${DEFAULT_TTL_DAYS} days'))
    `);

    const transaction = database.transaction(() => {
      for (const [url, record] of entries) {
        insert.run(url, record.title, record.score, record.processed_at, record.processed_at);
      }
    });

    transaction();
    console.log(`📦 Migrated ${entries.length} entries from processed_urls.json → SQLite`);

    // Backup legacy file
    const backupPath = LEGACY_JSON_PATH.replace(".json", ".json.bak");
    fs.renameSync(LEGACY_JSON_PATH, backupPath);
    console.log(`  → Legacy file backed up to ${backupPath}`);
  } catch (err) {
    console.warn(`⚠️ Legacy migration failed: ${errorMessage(err)}`);
  }
}

// ── TTL Cleanup ──

function purgeExpired(): void {
  const database = getDb();
  const result = database.prepare(`DELETE FROM processed_urls WHERE expires_at < datetime('now')`).run();
  const evaluated = database.prepare(`DELETE FROM evaluated_urls WHERE expires_at < datetime('now')`).run();

  const purged = result.changes + evaluated.changes;
  if (purged > 0) {
    console.log(`🧹 Purged ${purged} expired entries from state DB`);
  }
}

// ── Public API ──

let stateLookupsDisabled = false;

/**
 * Makes isProcessed() answer false without opening the state DB, for read-only tools such as
 * `npm run check:sources` that must neither create nor modify pipeline_state.db.
 */
export function disableStateLookups(): void {
  stateLookupsDisabled = true;
}

/**
 * Checks if a given URL has already been processed.
 * The URL is canonicalized first, so callers may pass the raw link from a feed. The raw form is
 * checked too: entries recorded before canonicalization was widened can still carry tracking
 * parameters (e.g. the BBC's at_medium) that the canonical form now drops.
 */
export function isProcessed(url: string): boolean {
  if (stateLookupsDisabled) return false;
  const database = getDb();
  const row = database
    .prepare(`SELECT 1 FROM processed_urls WHERE url IN (?, ?) AND expires_at > datetime('now')`)
    .get(normalizeUrl(url), url);
  return !!row;
}

/**
 * Records a URL (in canonical form) as successfully processed with metadata.
 * The entry expires after `settings.state_ttl_days`.
 */
export function markAsProcessed(url: string, title: string, score: number, purpose?: string): void {
  const database = getDb();
  database
    .prepare(
      `
    INSERT OR REPLACE INTO processed_urls (url, title, score, purpose, processed_at, expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now', ?))
  `,
    )
    .run(normalizeUrl(url), title, score, purpose ?? null, `+${config.settings.state_ttl_days} days`);
}

/**
 * Why an evaluated article was not summarized. Only outcomes the rules decide are recorded; an
 * extraction failure or an outage is not, so the article is retried by the next run.
 */
export type EvaluationOutcome = "below_threshold" | "excluded" | "not_selected";

/**
 * Records an article (in canonical form) that was evaluated but not summarized. The entry expires
 * after `settings.evaluated_ttl_days`; until then the article is dropped before its body is fetched.
 */
export function markAsEvaluated(url: string, outcome: EvaluationOutcome, score: number, purpose?: string): void {
  const database = getDb();
  database
    .prepare(
      `
    INSERT OR REPLACE INTO evaluated_urls (url, outcome, score, purpose, evaluated_at, expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now', ?))
  `,
    )
    .run(normalizeUrl(url), outcome, score, purpose ?? null, `+${config.settings.evaluated_ttl_days} days`);
}

/** Checks whether an article was evaluated and not summarized within `settings.evaluated_ttl_days`. */
export function isEvaluated(url: string): boolean {
  if (stateLookupsDisabled) return false;
  const database = getDb();
  const row = database
    .prepare(`SELECT 1 FROM evaluated_urls WHERE url IN (?, ?) AND expires_at > datetime('now')`)
    .get(normalizeUrl(url), url);
  return !!row;
}

/**
 * Persists state to disk. With SQLite this is a no-op since writes are immediate,
 * but we run VACUUM and purge expired entries for cleanup.
 */
export function flushState(): void {
  const database = getDb();
  purgeExpired();
  // Periodic VACUUM to reclaim space (safe even if run frequently)
  try {
    database.exec("VACUUM");
  } catch {
    // VACUUM can fail if other connections exist; non-fatal
  }
  console.log("💾 State DB flushed (SQLite).");
}

/**
 * Saves a pipeline run's metrics to the database for historical analysis.
 */
export function savePipelineRun(metrics: PipelineRunMetrics): void {
  const database = getDb();
  database
    .prepare(
      `
    INSERT OR REPLACE INTO pipeline_runs
    (run_id, date, started_at, finished_at, duration_ms,
     articles_ingested, articles_scored, articles_selected,
     articles_by_purpose, total_input_tokens, total_output_tokens,
     total_cost_usd, error_count, quality_score, metrics_json, run_status, status_reasons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      metrics.run_id,
      metrics.date,
      metrics.started_at,
      metrics.finished_at ?? null,
      metrics.duration_ms ?? null,
      metrics.articles_ingested,
      metrics.articles_scored,
      metrics.articles_selected,
      JSON.stringify(metrics.articles_by_purpose),
      metrics.total_tokens.input,
      metrics.total_tokens.output,
      metrics.total_cost_usd,
      metrics.errors.length,
      metrics.quality_score ?? null,
      JSON.stringify(metrics),
      metrics.run_status ?? null,
      metrics.status_reasons ? JSON.stringify(metrics.status_reasons) : null,
    );
}

/**
 * Records the health status of a source for monitoring.
 */
export function recordSourceHealth(
  sourceName: string,
  sourceType: string,
  status: SourceHealthStatus,
  articleCount: number,
  errorMessage?: string,
): void {
  const database = getDb();
  const today = new Date().toISOString().split("T")[0] ?? "unknown";
  database
    .prepare(
      `
    INSERT OR REPLACE INTO source_health
    (source_name, source_type, check_date, status, article_count, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(sourceName, sourceType, today, status, articleCount, errorMessage ?? null);
}

export type SourceHealthStatus = "ok" | "empty" | "error" | "disabled";

/**
 * Counts the leading run of failed or empty checks in rows ordered newest first.
 * A successful or disabled check ends the streak.
 */
export function computeFailureStreak(rows: ReadonlyArray<{ status: string; article_count: number }>): number {
  let streak = 0;
  for (const row of rows) {
    const failed = row.status === "error" || row.status === "empty" || (row.status === "ok" && row.article_count === 0);
    if (!failed) break;
    streak++;
  }
  return streak;
}

/**
 * Gets the number of consecutive checks (newest first, up to 14) in which a source failed or
 * returned no articles, for health alerting.
 */
export function getSourceFailureStreak(sourceName: string): number {
  const database = getDb();
  const rows = database
    .prepare(
      `
    SELECT status, article_count FROM source_health
    WHERE source_name = ?
    ORDER BY check_date DESC
    LIMIT 14
  `,
    )
    .all(sourceName) as Array<{ status: string; article_count: number }>;
  return computeFailureStreak(rows);
}

/**
/**
 * Titles of the URLs processed between `fromDaysAgo` and `toDaysAgo` days ago (UTC), oldest
 * first, with their purpose and processing day. Used for keyword expansion.
 */
export function getProcessedTitles(
  fromDaysAgo: number,
  toDaysAgo: number = 0,
): Array<{
  title: string;
  purpose: string | null;
  date: string;
}> {
  const database = getDb();
  return database
    .prepare(
      `
    SELECT title, purpose, date(processed_at) AS date
    FROM processed_urls
    WHERE processed_at >= datetime('now', '-' || ? || ' days')
      AND processed_at < datetime('now', '-' || ? || ' days')
    ORDER BY processed_at ASC
  `,
    )
    .all(fromDaysAgo, toDaysAgo) as Array<{ title: string; purpose: string | null; date: string }>;
}

/**
 * Closes the database connection gracefully.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
