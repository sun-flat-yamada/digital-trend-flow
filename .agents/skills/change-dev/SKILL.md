---
name: change-dev
description: End-to-end change lifecycle for digital-trend-flow — Work-Unit Issue, plan-first commit, branch naming, quality gate, walkthrough, draft PR, CI green, ready and rebase merge. Use for any code, configuration, workflow or documentation change.
---

# Change Dev Skill (`change-dev`)

Adapted from the `change-dev` skill of `sun-flat-yamada/github-copilot-dashboard`. The rules it implements: [`development-workflow.md`](../../rules/development-workflow.md), [`git-rules-commit.md`](../../rules/git-rules-commit.md), [`quality-rules-gate.md`](../../rules/quality-rules-gate.md), [`language-rules-output.md`](../../rules/language-rules-output.md), [`instructions-rules-precedence.md`](../../rules/instructions-rules-precedence.md).

Not imported from the reference: sibling worktrees (a single maintainer; cloud sessions run in isolated VMs), Antigravity `ArtifactMetadata`, fork and data-isolation rules, `CHG_DEV_AUTO_PILOT` (the owner's project instructions already fix the PR behavior), `change-dev:finish` (the merge goes through the GitHub tools).

---

## 🎫 Work-Unit Issue (one task = one Issue = one PR)

1. **Register**: one Issue per task with the `.github/ISSUE_TEMPLATE/work_unit.yml` sections: Why, What, Done condition, Acceptance Criteria, References and Prerequisites, How to start. Title: `[<task-id>] <imperative title>` (or a Conventional Commits title).
2. **Group**: one tracking Issue per phase / epic, `[Phase N] <name> — tracking`, with each task as a sub-issue. Close it when all children are closed.
3. **Start from an Issue** ("Issue #N を対応せよ"):
   1. Read the Issue, its parent, `AGENTS.md` and everything under References.
   2. Check that no open PR or merged change already covers it, and that the Prerequisites are merged. If not, stop and report.
   3. Follow the lifecycle below and open the PR with `Closes #N`.
4. **The Issue is the hand-off**: decisions, unverified items and open questions go into the Issue or the plan, never only into chat.
5. **Scope discipline**: out-of-scope findings become new Issues.

---

## 🛠️ Lifecycle

### Phase 1: Issue

Create or reference the Issue (see above). Get the branch name:

```bash
npm run change-dev:branch -- name --issue 42                     # type + title from the Issue → feat/42-reddit-source
npm run change-dev:branch -- name feat 42 "Add Reddit source"    # explicit
npm run change-dev:branch -- name feat 42 --slug reddit-source   # Japanese title: pass the slug
npm run change-dev:branch -- check [branch]                      # validate (default: the current branch)
```

### Phase 2: Plan first

Create `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` (`yyyy-mm-dd` = start date; `<ChangeTitle>` = PascalCase, no spaces) with:

**`implementation_plan.md`**

```markdown
# <Title> (#<issue>)

<Context and intent.>

## User Review Required
> [!IMPORTANT]
> <Decisions, breaking changes, what needs the owner's confirmation.>

> [!WARNING]
> <Edge cases, dependency updates, migration risks.>

## Proposed Changes
### <Area>
#### [NEW] [path/from/repo-root](../../../path/from/repo-root)
- Purpose.
#### [MODIFY] [path/from/repo-root](../../../path/from/repo-root)
- Targeted change.
#### [DELETE] [path/from/repo-root](../../../path/from/repo-root)
- Rationale.

## Verification Plan
### Automated Tests
- The quality gate (`quality-rules-gate.md`) and the specific test files.
### Manual Verification
- Dry runs (`DRY_RUN=true`, `npm run debug:filter <URL>`), CLI output checks.
```

**`task.md`**

```markdown
# Task: <Title> (#<issue>)

- [x] Phase 1: Issue #<issue>
- [x] Phase 2: Implementation plan committed on its own
- [ ] Phase 3: Branch
- [ ] Phase 4: Implementation + quality gate
- [ ] Phase 5: Walkthrough
- [ ] Phase 6: Draft PR (`Closes #<issue>`)
- [ ] Phase 7: CI green → ready → rebase merge
```

Commit both **by themselves** (`docs(<scope>): plan <change> (#<issue>)`) before any implementation file is created or edited, then run `npm run change-dev:plan-check`. Report a short summary of the plan and continue; stop only for the blocking cases in `development-workflow.md` Step 2. Writing the plan after the implementation is a defect even with the same content.

### Phase 3: Branch

- Local: `git fetch origin main && git checkout -b <type>/<issue>-<slug> origin/main`.
- Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`): the platform starts the session on `claude/<adjective>-<name>-<id>`. Right after Phase 1, before the first push, rename it and push only to the new name (owner-approved exception, `instructions-rules-precedence.md` §2):

  ```bash
  npm run change-dev:branch -- rename feat 42 "Add Reddit source"   # or: rename --issue 42 / --slug <slug>
  git push -u origin feat/42-add-reddit-source
  ```

  The helper refuses when the assigned branch already has pushed work of its own, when the new name exists locally or on `origin`, or when the current branch is `main`. After a merge, the next task in the same session starts with `git fetch origin main && git checkout -b <type>/<issue>-<slug> origin/main`.

### Phase 4: Implementation and quality gate

1. Follow `AGENTS.md` (Map-Reduce, `Promise.allSettled`, idempotency through `state_manager.ts`, citations, plugin registry) and `.agents/rules/coding-standards.md`.
2. Atomic Conventional Commits; keep `task.md` current.
3. Update `AGENTS.md` / `docs/` when behavior, configuration or architecture changes.
4. Run the quality gate (`quality-rules-gate.md`). Every step exits 0.

### Phase 5: Walkthrough

**`walkthrough.md`** in the change directory, then mark `task.md` done:

```markdown
# Walkthrough: <Title> (#<issue>)

## Summary
<What was delivered.>

## Changes Made
- [path/file.ts](../../../path/file.ts): what changed.

## Verification Results
| Stage | Command | Result |
| :--- | :--- | :--- |
| Type check | `npm run type-check` | ✅ |
| Lint / format | `npm run lint && npm run format:check` | ✅ |
| Config | `npm run test:config` | ✅ |
| Tests + coverage | `npm run test:coverage` | ✅ N suites / M tests |
| Build | `npm run build` | ✅ |
| Plan-first | `npm run change-dev:plan-check` | ✅ |
```

No secrets, PII or machine-specific absolute paths (`/home/<user>/...`, `file:///`) in change artifacts.

### Phase 6: Draft PR

1. `git fetch origin main && git rebase origin/main` (your own branch only), then push.
2. Open the PR as a **draft** from `.github/PULL_REQUEST_TEMPLATE.md` (Japanese description, `Closes #<issue>`). Cloud session: the GitHub MCP `create_pull_request` tool (`draft: true`), then subscribe to the PR's activity.

### Phase 7: CI green → ready → rebase merge

1. Wait for the PR events (do not poll). On a failure: reproduce, fix the root cause, re-run the quality gate, push. Never skip or disable a test.
2. Answer or fix every review thread.
3. When every check on the current head is green, there is no conflict and nothing waits on the agent: mark the PR ready (`update_pull_request` with `draft: false`) and merge with `merge_pull_request` (`merge_method: rebase`, `expectedHeadSha` = the checked head).
4. The cloud GitHub proxy rejects branch deletion: report a branch left behind, or enable *Automatically delete head branches* in the repository settings.
5. Next task: start again from the latest `origin/main`; never reuse the merged branch's history.

### Guardrails

- Never push to `main`, never bypass branch protection, never merge a Dependabot PR (report only).
- Never merge with a failed or running check, a conflict, or an unanswered review thread.
- Stop and report when checks stay red after real fixes, a rebase conflict is non-trivial, or a Phase 2 blocking case appears.
