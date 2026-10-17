# Adopt the change-dev workflow (#82)

Import the change-dev workflow of `sun-flat-yamada/github-copilot-dashboard` (Issue → plan → branch → quality gate → PR → rebase merge), adapted to this repository.

## User Review Required

> [!IMPORTANT]
> - The project instructions (owner's word) stay on top: the PR is opened as a **draft**, then marked ready and rebase-merged once CI is green. The reference repository opens it ready (Auto-Pilot); this repository does not import `CHG_DEV_AUTO_PILOT` because the project already fixes that behavior.
> - Renaming the cloud session branch (`claude/<adjective>-<name>-<id>` → `<type>/<issue>-<slug>`) widens "push only to the assigned branch". It needs the owner's approval. Until then the Branch Name Check only warns on cloud-assigned names.

> [!WARNING]
> - Not imported: sibling worktrees (single maintainer, cloud sessions are isolated VMs), Antigravity `ArtifactMetadata`, fork / data-isolation rules, `secret-scan` (no scanner in this repository yet; tracked as a separate Issue), `change-dev:finish` (merging goes through the GitHub tools).

## Proposed Changes

### Rules and skill
#### [NEW] [.agents/rules/development-workflow.md](../../../.agents/rules/development-workflow.md)
#### [NEW] [.agents/rules/git-rules-commit.md](../../../.agents/rules/git-rules-commit.md)
#### [NEW] [.agents/rules/instructions-rules-precedence.md](../../../.agents/rules/instructions-rules-precedence.md)
#### [NEW] [.agents/rules/language-rules-output.md](../../../.agents/rules/language-rules-output.md)
#### [NEW] [.agents/rules/quality-rules-gate.md](../../../.agents/rules/quality-rules-gate.md)
#### [NEW] [.agents/skills/change-dev/SKILL.md](../../../.agents/skills/change-dev/SKILL.md)

### Contributor documents and GitHub templates
#### [NEW] [CONTRIBUTING.md](../../../CONTRIBUTING.md)
#### [MODIFY] [.github/PULL_REQUEST_TEMPLATE.md](../../../.github/PULL_REQUEST_TEMPLATE.md)
#### [NEW] [.github/ISSUE_TEMPLATE/](../../../.github/ISSUE_TEMPLATE/) (`work_unit.yml`, `bug_report.yml`, `feature_request.yml`, `config.yml`)
#### [MODIFY] [AGENTS.md](../../../AGENTS.md), [docs/development.md](../../../docs/development.md)

### Helper CLIs and CI
#### [NEW] [src/cli/change_dev_branch.ts](../../../src/cli/change_dev_branch.ts) — `npm run change-dev:branch -- name|check|rename`
#### [NEW] [src/cli/plan_check.ts](../../../src/cli/plan_check.ts) — `npm run change-dev:plan-check`
#### [NEW] [tests/change_dev.test.ts](../../../tests/change_dev.test.ts)
#### [NEW] [.github/workflows/change_dev.yml](../../../.github/workflows/change_dev.yml)

## Verification Plan

### Automated Tests
- `npm run type-check && npm run lint && npm run format:check && npm test && npm run build`
- `npm run change-dev:plan-check` on this branch
- `actionlint` on the new workflow

### Manual Verification
- `npm run change-dev:branch -- name docs 82 "Adopt the change-dev workflow"` prints `docs/82-adopt-change-dev-workflow`
