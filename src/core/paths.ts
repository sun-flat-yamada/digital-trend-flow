/**
 * [Role] Centralized Configuration for File Paths
 *
 * Artifacts Directory Structure (Separated into sun-flat-yamada/artifacts repository):
 *
 * / (Repository Root / artifacts folder)
 * └── contents/
 *     └── digital-trend/
 *         ├── collection/
 *         │   ├── daily/
 *         │   │   └── YYYY/MM/YYYY-MM-DD_digital-trend_daily_summary.md
 *         │   ├── monthly/
 *         │   │   └── YYYY/YYYY-MM-DD_digital-trend_monthly_report.md
 *         │   ├── yearly/
 *         │   │   └── YYYY-MM-DD_digital-trend_yearly_report.md
 *         │   └── metrics/
 *         └── publish/
 *             ├── note/
 *             └── zenn/
 */
import path from "path";

export const PROJECT_ROOT = process.cwd();

export const PATHS = {
  // Config
  CONFIG: path.resolve(PROJECT_ROOT, "config.yml"),

  // Data & State
  DB: path.resolve(PROJECT_ROOT, "pipeline_state.db"),
  LEGACY_JSON: path.resolve(PROJECT_ROOT, "processed_urls.json"),
  PROMPTS: path.resolve(PROJECT_ROOT, "prompts"),

  // Output (Artifacts) relative and absolute
  ARTIFACTS_DAILY: {
    relative: "artifacts/contents/digital-trend/collection/daily",
    absolute: path.resolve(
      PROJECT_ROOT,
      "artifacts/contents/digital-trend/collection/daily",
    ),
  },
  ARTIFACTS_MONTHLY: {
    relative: "artifacts/contents/digital-trend/collection/monthly",
    absolute: path.resolve(
      PROJECT_ROOT,
      "artifacts/contents/digital-trend/collection/monthly",
    ),
  },
  ARTIFACTS_YEARLY: {
    relative: "artifacts/contents/digital-trend/collection/yearly",
    absolute: path.resolve(
      PROJECT_ROOT,
      "artifacts/contents/digital-trend/collection/yearly",
    ),
  },
  ARTIFACTS_METRICS: {
    relative: "artifacts/contents/digital-trend/collection/metrics",
    absolute: path.resolve(
      PROJECT_ROOT,
      "artifacts/contents/digital-trend/collection/metrics",
    ),
  },
  ARTIFACTS_AUDIO: {
    relative: "artifacts/contents/digital-trend/collection/audio",
    absolute: path.resolve(
      PROJECT_ROOT,
      "artifacts/contents/digital-trend/collection/audio",
    ),
  },
  ARTIFACTS_NOTE: {
    relative: "artifacts/contents/publish/note",
    absolute: path.resolve(PROJECT_ROOT, "artifacts/contents/publish/note"),
  },
  ARTIFACTS_ZENN: {
    relative: "artifacts/contents/publish/zenn",
    absolute: path.resolve(PROJECT_ROOT, "artifacts/contents/publish/zenn"),
  },

  // Tmp files (used usually by AI or tests, but kept for reference)
  TMP_AI: path.resolve(PROJECT_ROOT, "_tmp_ai"),
};
