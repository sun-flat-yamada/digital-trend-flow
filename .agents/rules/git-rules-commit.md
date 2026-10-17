---
description: "Conventional Commits and branch naming (<type>/<issue>-<slug>)."
alwaysApply: true
---

# Git Commit & Branch Rules (`git-rules-commit`)

## 1. Conventional Commits

```text
<type>(<optional-scope>): <short imperative description>

[optional body: motivation and trade-offs]

[optional footer(s): Closes #123, BREAKING CHANGE: ...]
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Keep a linear history: no merge commits on your own branch (rebase onto `origin/main` instead).

## 2. Branch naming

A branch is named after the change it carries, so that `git branch -r`, the PR list and the history tell what it is for.

```text
<type>/<issue>-<slug>     e.g. feat/42-reddit-source, fix/118-empty-rss-feed
<type>/<slug>             only when there is no Issue (small documentation-only changes)
```

| Part | Rule |
| :--- | :--- |
| `type` | A Conventional Commits type (§1); the type of the PR title |
| `issue` | The Issue number the PR closes, without `#` |
| `slug` | 2-6 English words describing the change: lowercase `a-z` / `0-9`, single hyphens, at most 40 characters; no articles, dates, agent or session names |
| Total | At most 60 characters |

- Generate and check names with the helper: `npm run change-dev:branch -- name <type> <issue> "<title>"` (or `name --issue <n>`, which reads the type and title from the Issue through `gh api`), and `npm run change-dev:branch -- check [branch]`.
- `main` and `dependabot/**` are exempt.
- **Names that do not describe the change are not used for PRs**, in particular the names the Claude Code cloud platform assigns (`claude/<adjective>-<name>-<id>`, `ccr-<hex>-<id>`). A cloud session renames its assigned branch before the first push: `npm run change-dev:branch -- rename <type> <issue> "<title>"` (or `--slug <slug>`), then `git push -u origin <new name>` ([`instructions-rules-precedence.md`](instructions-rules-precedence.md) §2).
- The `Change-dev Check` workflow fails a PR whose head branch does not follow this rule, including cloud-assigned names.

## 3. Language

See [`language-rules-output.md`](language-rules-output.md).

## 4. Before committing

Run the quality gate in [`quality-rules-gate.md`](quality-rules-gate.md).
