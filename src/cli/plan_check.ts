/**
 * Plan-first gate for the change-dev lifecycle (`.agents/rules/development-workflow.md` Step 2).
 *
 * `implementation_plan.md` must be committed BEFORE the implementation: the commit that adds
 * `.devs/changes/<dir>/implementation_plan.md` has to come strictly before the first commit that
 * touches implementation files. Documentation-only (`*.md`, `docs/`, `.devs/`) branches are exempt.
 *
 *   npm run change-dev:plan-check [-- --base origin/main] [--head HEAD]
 */
import { execFileSync } from "node:child_process";

export interface CommitChange {
  sha: string;
  /** `git log --name-status` entries (status letter + path), `--no-renames` */
  files: Array<{ status: string; path: string }>;
}

export interface PlanFirstResult {
  ok: boolean;
  /** true when the branch has no implementation files, so no plan is required */
  exempt: boolean;
  message: string;
}

const PLAN_PATH = /^\.devs\/changes\/[^/]+\/implementation_plan\.md$/;

/** Implementation = anything that is not a change artifact, a doc, or any Markdown file */
export function isImplementationFile(file: string): boolean {
  if (file.startsWith(".devs/") || file.startsWith("docs/")) return false;
  return !file.toLowerCase().endsWith(".md");
}

export function isPlanFile(file: string): boolean {
  return PLAN_PATH.test(file);
}

const short = (sha: string): string => sha.slice(0, 7);

/** commits: oldest first (the order of `git log --reverse base..head`) */
export function evaluatePlanFirst(commits: CommitChange[]): PlanFirstResult {
  const firstImpl = commits.findIndex((c) => c.files.some((f) => isImplementationFile(f.path)));
  if (firstImpl === -1) {
    return { ok: true, exempt: true, message: "No implementation files changed: a plan is not required." };
  }
  const planAt = commits.findIndex((c) => c.files.some((f) => f.status === "A" && isPlanFile(f.path)));
  if (planAt === -1) {
    return {
      ok: false,
      exempt: false,
      message:
        "Implementation files changed but no `.devs/changes/<dir>/implementation_plan.md` was added. " +
        "Write the plan and commit it alone BEFORE the implementation.",
    };
  }
  const implSha = short(commits[firstImpl]?.sha ?? "");
  if (planAt >= firstImpl) {
    const where = planAt === firstImpl ? "in the same commit as" : "after";
    return {
      ok: false,
      exempt: false,
      message:
        `implementation_plan.md was committed ${where} the first implementation commit (${implSha}). ` +
        "The plan must be committed first, on its own, before any implementation file is touched.",
    };
  }
  return {
    ok: true,
    exempt: false,
    message: `Plan-first OK: plan in ${short(commits[planAt]?.sha ?? "")}, first implementation in ${implSha}.`,
  };
}

export function parseGitLog(output: string): CommitChange[] {
  const commits: CommitChange[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("COMMIT ")) {
      commits.push({ sha: line.slice("COMMIT ".length).trim(), files: [] });
      continue;
    }
    const current = commits[commits.length - 1];
    if (!line.trim() || !current) continue;
    const [status, ...rest] = line.split("\t");
    const file = rest[rest.length - 1];
    if (status && file) current.files.push({ status: status.charAt(0), path: file });
  }
  return commits;
}

function readCommits(base: string, head: string): CommitChange[] {
  const out = execFileSync(
    "git",
    ["log", "--reverse", "--no-merges", "--no-renames", "--name-status", "--format=COMMIT %H", `${base}..${head}`],
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
  );
  return parseGitLog(out);
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

function main(): number {
  const base = arg("--base", "origin/main");
  const head = arg("--head", "HEAD");
  let result: PlanFirstResult;
  try {
    result = evaluatePlanFirst(readCommits(base, head));
  } catch (e) {
    console.error(
      `[plan-first] could not read git history for ${base}..${head}: ${(e as Error).message.split("\n")[0]}`,
    );
    return 1;
  }
  if (result.ok) {
    console.log(`[plan-first] ✅ ${result.message}`);
    return 0;
  }
  console.error(`[plan-first] ❌ ${result.message}`);
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
