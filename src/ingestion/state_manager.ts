/**
 * [Role] Manages pipeline state via SQLite for idempotent processing.
 * [Mechanism] Uses better-sqlite3 for synchronous, high-performance state
 * management with TTL-based automatic cleanup and pipeline run statistics.
 *
 * Items: 5.1 SQLite 移行, 5.2 TTL 実装, 5.3 処理統計永続化
 *
 * Migration from processed_urls.json:
 * - On first run, if processed_urls.json exists, its data is imported
 *   into the SQLite DB and the JSON file is renamed to .bak.
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import type { PipelineRunMetrics } from "../core/metrics";
import { PATHS } from "../core/paths";

const DB_PATH = PATHS.DB;
const LEGACY_JSON_PATH = PATHS.LEGACY_JSON;
const DEFAULT_TTL_DAYS = 90;

// ── Database Initialization ──

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // Write-Ahead Logging for better concurrency
  db.pragma("foreign_keys = ON");

  // Create tables
  db.exec(`
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
      status TEXT NOT NULL, -- 'ok' | 'empty' | 'error'
      article_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      PRIMARY KEY (source_name, check_date)
    );

    CREATE INDEX IF NOT EXISTS idx_source_health_date
      ON source_health(check_date);
  `);

  // Migrate from legacy JSON if it exists
  migrateLegacyJson();

  // Purge expired entries on startup
  purgeExpired();

  return db;
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
  } catch (err: any) {
    console.warn(`⚠️ Legacy migration failed: ${err.message}`);
  }
}

// ── TTL Cleanup ──

function purgeExpired(): void {
  const database = getDb();
  const result = database.prepare(
    `DELETE FROM processed_urls WHERE expires_at < datetime('now')`
  ).run();

  if (result.changes > 0) {
    console.log(`🧹 Purged ${result.changes} expired entries from state DB`);
  }
}

// ── Public API ──

/**
 * Checks if a given URL has already been processed.
 */
export function isProcessed(url: string): boolean {
  const database = getDb();
  const row = database.prepare(
    `SELECT 1 FROM processed_urls WHERE url = ? AND expires_at > datetime('now')`
  ).get(url);
  return !!row;
}

/**
 * Records a URL as successfully processed with metadata.
 */
export function markAsProcessed(
  url: string,
  title: string,
  score: number,
  purpose?: string
): void {
  const database = getDb();
  database.prepare(`
    INSERT OR REPLACE INTO processed_urls (url, title, score, purpose, processed_at, expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+${DEFAULT_TTL_DAYS} days'))
  `).run(url, title, score, purpose ?? null);
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
  database.prepare(`
    INSERT OR REPLACE INTO pipeline_runs
    (run_id, date, started_at, finished_at, duration_ms,
     articles_ingested, articles_scored, articles_selected,
     articles_by_purpose, total_input_tokens, total_output_tokens,
     total_cost_usd, error_count, quality_score, metrics_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    JSON.stringify(metrics)
  );
}

/**
 * Records the health status of a source for monitoring.
 */
export function recordSourceHealth(
  sourceName: string,
  sourceType: string,
  status: "ok" | "empty" | "error",
  articleCount: number,
  errorMessage?: string
): void {
  const database = getDb();
  const today = new Date().toISOString().split("T")[0] ?? "unknown";
  database.prepare(`
    INSERT OR REPLACE INTO source_health
    (source_name, source_type, check_date, status, article_count, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sourceName, sourceType, today, status, articleCount, errorMessage ?? null);
}

/**
 * Gets consecutive days a source has returned 0 articles (for health alerting).
 */
export function getSourceEmptyStreak(sourceName: string): number {
  const database = getDb();
  const rows = database.prepare(`
    SELECT status, article_count FROM source_health
    WHERE source_name = ?
    ORDER BY check_date DESC
    LIMIT 14
  `).all(sourceName) as Array<{ status: string; article_count: number }>;

  let streak = 0;
  for (const row of rows) {
    if (row.status === "error" || (row.status === "ok" && row.article_count === 0)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Gets the total number of processed URLs (for monitoring).
 */
export function getProcessedCount(): number {
  const database = getDb();
  const row = database.prepare(
    `SELECT COUNT(*) as count FROM processed_urls WHERE expires_at > datetime('now')`
  ).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Gets recent pipeline run history for trend analysis.
 */
export function getRecentRuns(days: number = 30): Array<{
  date: string;
  articles_selected: number;
  total_cost_usd: number;
  duration_ms: number;
}> {
  const database = getDb();
  return database.prepare(`
    SELECT date, articles_selected, total_cost_usd, duration_ms
    FROM pipeline_runs
    WHERE date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `).all(days) as Array<{
    date: string;
    articles_selected: number;
    total_cost_usd: number;
    duration_ms: number;
  }>;
}

/**
 * Debug utility to clear the state.
 */
export function clearState(): void {
  if (db) {
    db.close();
    db = null;
  }
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
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
