# Walkthrough: Disable Claude attribution (#103)

## Summary
リポジトリの `.claude/settings.json` に `attribution`（`commit` と `pr` を空文字列）を追加し、Claude Code がコミットと PR に付ける署名を止めた。ローカル PC とクラウドのセッションの両方に効く。

## Changes Made
- [.claude/settings.json](../../../.claude/settings.json): `attribution.commit` / `attribution.pr` を空文字列で追加。`hooks.SessionStart` は保持。
- [docs/development.md](../../../docs/development.md): 設定の説明を追記。

## Verification Results
| Stage | Command | Result |
| :--- | :--- | :--- |
| Type check | `npm run type-check` | ✅ |
| Lint / format | `npm run lint && npm run format:check` | ✅ |
| Config | `npm run test:config` | ✅ |
| Tests + coverage | `npm run test:coverage` | ✅ 49 suites / 369 tests |
| Build | `npm run build` | ✅ |
| Plan-first | `npm run change-dev:plan-check` | ✅ |
