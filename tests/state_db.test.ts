/**
 * Tests for the state DB schema migrations and the evaluated-article records (state_manager.ts),
 * against a real SQLite DB: `:memory:` or a file under _tmp_ai/ (via PIPELINE_STATE_DB).
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

jest.mock("../src/core/config", () => ({
  config: { settings: { state_ttl_days: 90, evaluated_ttl_days: 7 }, exclude: { url_strip_parameters: [] } },
  env: {},
}));

type StateManager = typeof import("../src/ingestion/state_manager");

const tmpDir = path.join(process.cwd(), "_tmp_ai", "test_state_db");

/** Loads a fresh state_manager that opens the given DB. */
function loadStateManager(dbPath: string): StateManager {
  jest.resetModules();
  process.env["PIPELINE_STATE_DB"] = dbPath;
  return require("../src/ingestion/state_manager") as StateManager;
}

/** The version 1 schema as it was created before migrations existed (user_version 0). */
function createLegacyDb(file: string): void {
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE processed_urls (
      url TEXT PRIMARY KEY, title TEXT NOT NULL, score REAL NOT NULL DEFAULT 0, purpose TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+90 days'))
    );
    CREATE TABLE pipeline_runs (run_id TEXT PRIMARY KEY, date TEXT NOT NULL, started_at TEXT NOT NULL);
    CREATE TABLE source_health (
      source_name TEXT NOT NULL, source_type TEXT NOT NULL, check_date TEXT NOT NULL, status TEXT NOT NULL,
      article_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, PRIMARY KEY (source_name, check_date)
    );
    INSERT INTO processed_urls (url, title, score) VALUES ('https://example.com/old', 'Old', 42);
  `);
  legacy.close();
}

describe("state DB", () => {
  let state: StateManager | undefined;

  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => state?.closeDb());
  afterAll(() => {
    jest.restoreAllMocks();
    delete process.env["PIPELINE_STATE_DB"];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("a new DB is created at the latest schema version", () => {
    state = loadStateManager(":memory:");
    expect(state.getSchemaVersion()).toBe(state.SCHEMA_VERSION);
    expect(state.SCHEMA_VERSION).toBe(2);
    expect(state.isProcessed("https://example.com/a")).toBe(false);
  });

  test("a DB from before versioning is migrated and keeps its data", () => {
    const file = path.join(tmpDir, "legacy.db");
    createLegacyDb(file);

    state = loadStateManager(file);
    expect(state.getSchemaVersion()).toBe(2);
    expect(state.isProcessed("https://example.com/old")).toBe(true);
    state.markAsEvaluated("https://example.com/new", "excluded", 0, "tech");
    expect(state.isEvaluated("https://example.com/new")).toBe(true);
  });

  test("an evaluated article is not marked processed, and its record expires", () => {
    const file = path.join(tmpDir, "expiry.db");
    state = loadStateManager(file);
    state.markAsEvaluated("https://example.com/a?utm_source=x", "below_threshold", 3.5, "tech");

    // Looked up in canonical form, like isProcessed.
    expect(state.isEvaluated("https://example.com/a")).toBe(true);
    expect(state.isProcessed("https://example.com/a")).toBe(false);
    expect(state.isEvaluated("https://example.com/b")).toBe(false);
    state.closeDb();

    const raw = new Database(file);
    expect(raw.prepare("SELECT outcome, score, purpose FROM evaluated_urls").get()).toEqual({
      outcome: "below_threshold",
      score: 3.5,
      purpose: "tech",
    });
    const expiresInDays = raw
      .prepare("SELECT julianday(expires_at) - julianday(evaluated_at) AS days FROM evaluated_urls")
      .get() as { days: number };
    expect(expiresInDays.days).toBeCloseTo(7);
    raw.prepare("UPDATE evaluated_urls SET expires_at = datetime('now', '-1 day')").run();
    raw.close();

    state = loadStateManager(file);
    expect(state.isEvaluated("https://example.com/a")).toBe(false);
  });

  test("a DB from a newer schema version is refused", () => {
    const file = path.join(tmpDir, "future.db");
    const future = new Database(file);
    future.pragma("user_version = 99");
    future.close();

    state = loadStateManager(file);
    expect(() => state?.getSchemaVersion()).toThrow(/schema version 99 is newer/);
    // A failed open is not cached: the next call refuses the DB again.
    expect(() => state?.isProcessed("https://example.com/a")).toThrow(/schema version 99 is newer/);
  });
});
