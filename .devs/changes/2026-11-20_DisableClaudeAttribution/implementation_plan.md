# Disable Claude attribution (#103)

Claude Code が作るコミットに `Co-Authored-By` / `Claude-Session` 行、PR 本文に "Generated with Claude Code" 署名が付く。オーナーはこれを付けない運用にする。ローカル PC とクラウドのセッションで同じ設定になるよう、リポジトリの `.claude/settings.json` に登録する。

## User Review Required
> [!IMPORTANT]
> なし。オーナーの依頼どおりの設定追加のみ。

> [!WARNING]
> `attribution` は新しい版の Claude Code の設定キー。古い版は `includeCoAuthoredBy: false` を使うが、本リポジトリでは新しい書き方だけを入れる。

## Proposed Changes
### Claude Code settings
#### [MODIFY] [.claude/settings.json](../../../.claude/settings.json)
- `"attribution": {"commit": "", "pr": ""}` を追加する。既存の `hooks.SessionStart` は保持する。
### Docs
#### [MODIFY] [docs/development.md](../../../docs/development.md)
- Claude Code on the web の節に、署名を付けない設定の説明を追記する。

## Verification Plan
### Automated Tests
- `node -e 'JSON.parse(...)'` で JSON として読めること。
- 品質ゲート: `npm run type-check`, `npm run lint`, `npm run format:check`, `npm run test:config`, `npm run test:coverage`, `npm run build`, `npm run change-dev:plan-check`。
### Manual Verification
- `hooks.SessionStart` が残っていることを確認する。
