---
description: "Which language to use for replies, PRs, commits, code and comments."
alwaysApply: true
---

# Output Language Rules (`language-rules-output`)

| Artifact | Language |
| :--- | :--- |
| Replies to the user in chat | Japanese |
| Pull request titles | English Conventional Commits prefix (`feat(scope):`); the description after the colon may be English or Japanese |
| Pull request descriptions (filled `.github/PULL_REQUEST_TEMPLATE.md`) | Japanese; keep technical terms, identifiers and error messages in English |
| Issues | Japanese body; the title may keep an English `[<task-id>]` prefix |
| Commit messages | English (Conventional Commits) |
| Code, identifiers | English |
| Code comments | Follow the surrounding file (this repository mixes English and Japanese) |
| Documentation | Follow the existing language of each file (`AGENTS.md` and `.agents/` are English; `docs/` is Japanese) |
