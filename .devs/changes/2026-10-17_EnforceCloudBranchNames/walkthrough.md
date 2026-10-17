# Walkthrough: Enforce change-dev branch names for cloud sessions (#87)

## Summary

The owner-approved branch rename exception is now active: a cloud session renames `claude/<adjective>-<name>-<id>` to `<type>/<issue>-<slug>` before the first push, and the `Change-dev Check` fails PRs from cloud-assigned names. This PR itself comes from the renamed `ci/87-enforce-cloud-branch-names`.

## Changes Made

- [.agents/rules/instructions-rules-precedence.md](../../../.agents/rules/instructions-rules-precedence.md): §2 exception approved (2026-10-17), §4 row.
- [.agents/rules/git-rules-commit.md](../../../.agents/rules/git-rules-commit.md), [.agents/rules/development-workflow.md](../../../.agents/rules/development-workflow.md), [.agents/skills/change-dev/SKILL.md](../../../.agents/skills/change-dev/SKILL.md): rename before the first push.
- [CONTRIBUTING.md](../../../CONTRIBUTING.md), [docs/development.md](../../../docs/development.md): the check now fails on cloud-assigned names.
- [.github/workflows/change_dev.yml](../../../.github/workflows/change_dev.yml): `--warn-cloud` removed.
- [src/cli/change_dev_branch.ts](../../../src/cli/change_dev_branch.ts): the error names the rename command; [tests/change_dev.test.ts](../../../tests/change_dev.test.ts) covers it.

## Verification Results

| Stage | Command | Result |
| :--- | :--- | :--- |
| Type check | `npm run type-check` | ✅ |
| Lint / format | `npm run lint && npm run format:check` | ✅ |
| Config | `npm run test:config` | ✅ |
| Tests + coverage | `npm run test:coverage` | ✅ 369 tests |
| Build | `npm run build` | ✅ |
| Workflows | `actionlint` v1.7.12 | ✅ |
| Branch name | `npm run change-dev:branch -- check` | ✅ `ci/87-enforce-cloud-branch-names`; `claude/project-thread-8r6ziw` → exit 1 |
