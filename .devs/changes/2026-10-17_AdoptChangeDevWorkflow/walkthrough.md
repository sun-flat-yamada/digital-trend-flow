# Walkthrough: Adopt the change-dev workflow (#82)

## Summary

The change-dev workflow of `sun-flat-yamada/github-copilot-dashboard` is now this repository's documented way of changing code: Issue → plan committed first → `<type>/<issue>-<slug>` branch → quality gate → walkthrough → draft PR → CI green → ready → Rebase & Merge. Two helper CLIs and a PR check enforce the branch name and plan-first.

## Changes Made

### Rules and skill
- [.agents/rules/development-workflow.md](../../../.agents/rules/development-workflow.md): the 7-step lifecycle and merge rules.
- [.agents/rules/git-rules-commit.md](../../../.agents/rules/git-rules-commit.md): Conventional Commits and branch naming.
- [.agents/rules/quality-rules-gate.md](../../../.agents/rules/quality-rules-gate.md): the gate (same steps as CI, plus plan-check).
- [.agents/rules/language-rules-output.md](../../../.agents/rules/language-rules-output.md): output languages.
- [.agents/rules/instructions-rules-precedence.md](../../../.agents/rules/instructions-rules-precedence.md): owner > repository > environment defaults; the branch-rename exception is pending the owner's approval.
- [.agents/skills/change-dev/SKILL.md](../../../.agents/skills/change-dev/SKILL.md): procedure and plan / task / walkthrough schemas.

### Contributor documents and templates
- [CONTRIBUTING.md](../../../CONTRIBUTING.md), [AGENTS.md](../../../AGENTS.md) §2 / §8, [docs/development.md](../../../docs/development.md).
- [.github/PULL_REQUEST_TEMPLATE.md](../../../.github/PULL_REQUEST_TEMPLATE.md): Japanese, quality gate and Git checklist.
- [.github/ISSUE_TEMPLATE/](../../../.github/ISSUE_TEMPLATE/): `work_unit.yml`, `bug_report.yml`, `config.yml`.

### Helpers and CI
- [src/cli/change_dev_branch.ts](../../../src/cli/change_dev_branch.ts): `npm run change-dev:branch -- name|check|rename`.
- [src/cli/plan_check.ts](../../../src/cli/plan_check.ts): `npm run change-dev:plan-check`.
- [tests/change_dev.test.ts](../../../tests/change_dev.test.ts): 12 tests.
- [.github/workflows/change_dev.yml](../../../.github/workflows/change_dev.yml): branch name (cloud-assigned names warn) and plan-first on every PR.

## Verification Results

| Stage | Command | Result |
| :--- | :--- | :--- |
| Type check | `npm run type-check` | ✅ |
| Lint / format | `npm run lint && npm run format:check` | ✅ |
| Config | `npm run test:config` | ✅ |
| Tests + coverage | `npm run test:coverage` | ✅ 48 suites / 338 tests |
| Build | `npm run build` | ✅ |
| Workflows | `actionlint` v1.7.12 | ✅ |
| Plan-first | `npm run change-dev:plan-check` | ✅ plan before the first implementation commit |
| Branch name | `npm run change-dev:branch -- check --warn-cloud` | ⚠️ cloud-assigned name (warning only, rename pending approval) |
