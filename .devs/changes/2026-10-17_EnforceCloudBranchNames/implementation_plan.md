# Enforce change-dev branch names for cloud sessions (#87)

The owner approved the branch rename exception on 2026-10-17 ("ブランチ改名を許可する"). Turn it on and make the `Change-dev Check` fail on cloud-assigned names.

## User Review Required

> [!IMPORTANT]
> A cloud session renames its assigned `claude/<adjective>-<name>-<id>` branch with `npm run change-dev:branch -- rename ...` before the first push, and then pushes only to the renamed branch. The conditions are unchanged from the reference repository (no pushed work on the assigned branch, the new name is unused, never `main`).

> [!WARNING]
> Any PR opened from a cloud-assigned name now fails CI. Open PRs from such names must be re-opened from a renamed branch.

## Proposed Changes

#### [MODIFY] [.agents/rules/instructions-rules-precedence.md](../../../.agents/rules/instructions-rules-precedence.md) — §2 exception approved; §4 known-conflict row
#### [MODIFY] [.agents/rules/git-rules-commit.md](../../../.agents/rules/git-rules-commit.md), [.agents/rules/development-workflow.md](../../../.agents/rules/development-workflow.md), [.agents/skills/change-dev/SKILL.md](../../../.agents/skills/change-dev/SKILL.md)
#### [MODIFY] [CONTRIBUTING.md](../../../CONTRIBUTING.md), [docs/development.md](../../../docs/development.md)
#### [MODIFY] [.github/workflows/change_dev.yml](../../../.github/workflows/change_dev.yml) — drop `--warn-cloud`

## Verification Plan

- Quality gate (`quality-rules-gate.md`), `actionlint`
- `npm run change-dev:branch -- check claude/project-thread-8r6ziw` exits 1; this PR comes from `ci/87-enforce-cloud-branch-names` and passes
