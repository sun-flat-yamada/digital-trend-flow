/**
 * Entry point of the daily pipeline (`npm start`, used by .github/workflows/daily_summary.yml).
 * Runs the pipeline, shuts it down, exposes the `run_status` step output and sets the exit code.
 */

import * as fs from "fs";
import { finishFailed, runDailyPipeline, shutdownPipeline } from "../main";
import { registry } from "../core/plugin_registry";

// A degraded run exits non-zero so the job fails visibly; the workflow reads the `run_status`
// step output to still commit the run record (see .github/workflows/daily_summary.yml).
export const EXIT_CODE_DEGRADED = 2;
export const EXIT_CODE_FAILED = 1;

/** Exposes a step output (e.g. `run_status`) to later workflow steps, when running in Actions. */
function writeGitHubOutput(key: string, value: string): void {
  const outputPath = process.env["GITHUB_OUTPUT"];
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${key}=${value}\n`, "utf8");
}

/** Runs the daily pipeline to completion and resolves with the process exit code. Never rejects. */
export async function runDaily(): Promise<number> {
  try {
    const status = await runDailyPipeline();
    await shutdownPipeline();
    writeGitHubOutput("run_status", status);
    return status === "degraded" ? EXIT_CODE_DEGRADED : 0;
  } catch (err) {
    console.error("💀 Fatal pipeline error:", err);
    // The run record, metrics JSON and job summary are kept for a failed run too (before the DB closes).
    finishFailed(err);
    await shutdownPipeline();
    await registry.events.emit("pipeline:error", { error: String(err) }).catch(() => {});
    writeGitHubOutput("run_status", "failed");
    return EXIT_CODE_FAILED;
  }
}

if (require.main === module) {
  void runDaily().then((code) => process.exit(code));
}
