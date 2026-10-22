# Skip the change-dev check on Dependabot branches (#93)

The `Branch name and plan-first` job in `Change-dev Check` skips Dependabot PRs with `github.actor != 'dependabot[bot]'`.
When anyone else pushes a fix to a Dependabot PR, the actor changes, the job runs, and it fails on the `dependabot/...` branch name and the missing plan (seen on #90).

## User Review Required
> [!IMPORTANT]
> The job is skipped for every same-repository PR whose head branch starts with `dependabot/`, whoever pushed last.

> [!WARNING]
> A human could name a branch `dependabot/...` to skip the check. The repository owner is the only writer, so this is accepted.

## Proposed Changes
### CI
#### [MODIFY] [.github/workflows/change_dev.yml](../../../.github/workflows/change_dev.yml)
- Replace `github.actor != 'dependabot[bot]'` with `!startsWith(github.head_ref, 'dependabot/')` in the job's `if`.

## Verification Plan
### Automated Tests
- actionlint (CI job `Lint workflows (actionlint)`), `npm run change-dev:plan-check`, and the quality gate (`npm test`, `npm run lint`, `npm run format:check`, `npm run build`).
### Manual Verification
- This PR's own branch is not `dependabot/...`, so the job must run and pass on it.
