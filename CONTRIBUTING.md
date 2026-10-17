# Contributing to digital-trend-flow

人と AI エージェント（Claude Code, Gemini, Cursor, Copilot など）が同じ手順で変更する。規則の本体は `.agents/rules/`、手順の詳細は [`.agents/skills/change-dev/SKILL.md`](.agents/skills/change-dev/SKILL.md)。プロジェクトの設計と規約は [`AGENTS.md`](AGENTS.md)。

## 変更の流れ

```text
[1 Issue] → [2 計画] → [3 ブランチ] → [4 実装 + 品質ゲート] → [5 Walkthrough] → [6 ドラフト PR] → [7 CI 緑 → Ready → Rebase & Merge]
```

1. **Issue**: 1 タスク = 1 Issue = 1 PR。テンプレート `🎫 Work Unit` で Why / What / 完了条件 / 受け入れ基準 / 参照・前提 / 作業開始方法を書く。着手前に、既存の PR やマージ済みの対応がないかを確認する。範囲外の発見は新しい Issue にする。
2. **計画を先にコミット**: `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` に `implementation_plan.md` と `task.md` を書き、実装より前に単独でコミットする。`npm run change-dev:plan-check` で確認する（ドキュメントのみの変更は対象外）。
3. **ブランチ**: `<type>/<issue>-<slug>`（例: `feat/42-reddit-source`）。`npm run change-dev:branch -- name --issue <n>` で作り、`npm run change-dev:branch -- check` で確認する。
4. **実装と品質ゲート**: Conventional Commits で小さくコミットし、push の前に品質ゲートを通す（下記）。挙動・設定・構成を変えたら `AGENTS.md` と `docs/` も同じ PR で直す。
5. **Walkthrough**: 変更ディレクトリに `walkthrough.md`（概要・変更ファイル・品質ゲートの結果）を書く。
6. **ドラフト PR**: `origin/main` に rebase してから push し、`.github/PULL_REQUEST_TEMPLATE.md` に沿って日本語で書き、`Closes #<issue>` を入れてドラフトで出す。
7. **マージ**: CI が緑で、競合も未回答のレビューもなければ Ready for review にして **Rebase & Merge** する。`main` への直接 push はしない。Dependabot の PR はエージェントがマージしない。

## 品質ゲート

```bash
GEMINI_API_KEY=dummy npm run type-check
npm run lint
npm run format:check
GEMINI_API_KEY=dummy npm run test:config
GEMINI_API_KEY=dummy npm run test:coverage
npm run build
npm run change-dev:plan-check
```

ワークフローを変えたら `actionlint`、プロンプトや Map / Reduce を変えたら `npm run test:golden` も実行する。詳細は [`.agents/rules/quality-rules-gate.md`](.agents/rules/quality-rules-gate.md)。

## 言語

チャットの返信・PR の説明・Issue は日本語、コミットメッセージ・コード・識別子は英語。PR タイトルは英語の Conventional Commits の接頭辞（`feat(scope):`）で始める。詳細は [`.agents/rules/language-rules-output.md`](.agents/rules/language-rules-output.md)。

## CI での検査

| Workflow | 内容 |
| :--- | :--- |
| `ci.yml` | 型チェック・lint・整形・設定検証・テスト（カバレッジ）・ビルド・actionlint |
| `change_dev.yml` | PR のブランチ名（`<type>/<issue>-<slug>`）と plan-first。クラウドセッションの割り当て名（`claude/...`）は警告 |
