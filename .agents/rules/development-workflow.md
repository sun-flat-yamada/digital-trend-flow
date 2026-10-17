---
description: "change-dev lifecycle: Issue → plan → branch → quality gate → draft PR → CI green → ready → rebase merge."
alwaysApply: true
---

# Development Workflow (`development-workflow`)

Adapted from `sun-flat-yamada/github-copilot-dashboard` (`.agents/rules/development-workflow.md`). Every AI agent (Claude Code, Gemini, Cursor, Copilot, ...) and every human contributor follows this lifecycle. The step-by-step procedure is the `change-dev` skill: [`.agents/skills/change-dev/SKILL.md`](../skills/change-dev/SKILL.md).

## 1. Direct pushes

- **Never push directly to `main`.** Every change goes through a pull request and is merged with **Rebase & Merge**.
- Dependabot PRs are not merged by agents: report their state only.

## 2. The lifecycle

```text
[1 Issue] → [2 Plan] → [3 Branch] → [4 Implement + quality gate] → [5 Walkthrough] → [6 Draft PR] → [7 CI green → ready → rebase merge]
```

### Step 1: Issue

- Every non-trivial change starts from an Issue with **Why**, **What**, **Done condition** and **Acceptance Criteria** (template: `.github/ISSUE_TEMPLATE/work_unit.yml`).
- **One task = one Issue = one PR.** Larger work is split into Work-Unit Issues under a tracking Issue (`[Phase N] <name> — tracking`) as sub-issues.
- Before starting, check that no open PR or merged change already covers the Issue, and that its Prerequisites are merged.
- Findings outside the Issue's scope become new Issues, not extra changes in the PR. Leftovers are always recorded as Issues.

### Step 2: Plan first

- Before touching any implementation file, write `.devs/changes/yyyy-mm-dd_<ChangeTitle>/implementation_plan.md` and `task.md` (schemas in the skill) and **commit them on their own**.
- `npm run change-dev:plan-check` fails when the plan is missing, committed after the first implementation commit, or in the same commit. Documentation-only branches (`*.md`, `docs/`, `.devs/`) are exempt. The `Change-dev Check` workflow runs it on every PR.
- The plan is not a stop: report a short summary and continue. Stop and ask only when a prerequisite is not merged, the Issue's scope is ambiguous, or a step is irreversible or destructive (data deletion, history rewrite on someone else's branch, credential changes, production publishing).

### Step 3: Branch

- Name: `<type>/<issue>-<slug>` ([`git-rules-commit.md`](git-rules-commit.md) §2). Generate it with `npm run change-dev:branch -- name --issue <n>`.
- Local work starts from the latest base: `git fetch origin main && git checkout -b <name> origin/main`.
- Claude Code cloud session: the session VM is the isolation unit (no worktree). The platform assigns `claude/<adjective>-<name>-<id>`; see [`instructions-rules-precedence.md`](instructions-rules-precedence.md) §2 for when it may be renamed.

### Step 4: Implement and run the quality gate

- Atomic Conventional Commits; keep `task.md` current.
- Update `docs/` and `AGENTS.md` in the same change when behavior, configuration or architecture changes.
- Run the quality gate ([`quality-rules-gate.md`](quality-rules-gate.md)) before every push.

### Step 5: Walkthrough

- Add `walkthrough.md` to the change directory: summary, changed files, and the quality gate results table. Mark `task.md` done.
- Change artifacts contain no secrets, no PII and no machine-specific absolute paths; link files with repository-relative links (`../../../<path>`).

### Step 6: Pull request

- Rebase onto the latest base before the first push (`git fetch origin main && git rebase origin/main`).
- Open the PR as a **draft**, filled from `.github/PULL_REQUEST_TEMPLATE.md`, with `Closes #<issue>`.
- Language: [`language-rules-output.md`](language-rules-output.md).

### Step 7: CI green → ready → rebase merge

- The task is not done at PR creation. Drive CI to green: fix failures at the root cause, never skip or disable tests, answer every review thread.
- When CI is green on the current head, there is no conflict and no review thread waits on the agent: mark the PR **ready for review** and merge it with **Rebase & Merge** at the checked head SHA. The owner works alone and does not want to be the merge bottleneck.
- Never bypass branch protection, never merge with a failed or running check, a conflict, or an unanswered review thread.
- After the merge, start the next change from the latest `origin/main` under its own branch name; never stack new commits on merged history.
