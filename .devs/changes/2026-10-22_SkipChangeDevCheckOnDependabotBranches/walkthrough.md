# Walkthrough: Skip the change-dev check on Dependabot branches (#93)

## Change
- `.github/workflows/change_dev.yml`: the `Branch name and plan-first` job now skips PRs whose head branch starts with `dependabot/`, instead of PRs whose last pusher is `dependabot[bot]`. A fix pushed to a Dependabot PR (as on #90) no longer fails the job.

## Quality gate
| Check | Result |
| :--- | :--- |
| `actionlint` v1.7.12 on `change_dev.yml` | pass |
| `npm run change-dev:plan-check` | pass |
| `npm test` | pass |
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm run build` | pass |

## Notes
- This PR's branch is not `dependabot/...`, so the job runs on it and checks the branch name and plan-first as before.
