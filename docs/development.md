# Development

## Prerequisites

- **Node.js** 24+
- **npm** 10+
- **Git**

## Setup

```bash
git clone https://github.com/sun-flat-yamada/digital-trend-flow.git
cd digital-trend-flow
npm install
cp .env.example .env
# .env に GEMINI_API_KEY を設定
```

## Commands

| Command | Description |
|:---|:---|
| `npm test` | 型チェック (`tsc --noEmit`) + 設定 MECE 検証 + Jest (75+ tests) |
| `npm run test:unit` | Jest テストのみ |
| `npm run test:golden` | Golden regression テスト |
| `npm run test:config` | config.yml の論理検証 |
| `npm run type-check` | TypeScript 型チェック |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | フルパイプライン実行 |
| `npm run debug:filter <URL>` | Dry-run (LLM 不要・API コストなし) |
| `npm run lint` | ESLint (TypeScript, JSON, YAML) |
| `npm run format` | ESLint --fix |

## Coding Standards

| Rule | Detail |
|:---|:---|
| **Language** | TypeScript Strict Mode |
| **Module** | `nodenext` (ESM + `.js` imports) |
| **Target** | `esnext` |
| **Paradigm** | Functional Programming (OOP 最小限) |
| **Strict Flags** | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| **Resilience** | `Promise.allSettled` 必須、単一記事の失敗でパイプライン停止しない |
| **Idempotency** | SQLite State Manager で URL 重複排除 |
| **Citations** | 出典 URL は Map-Reduce 全工程で保持 |

## debug:filter

LLM を使わずにスコアリングロジックをテストできます:

```bash
npm run debug:filter "https://venturebeat.com/ai/"
```

```text
🔍 Starting Dry-Run for URL: https://venturebeat.com/ai/
⏳ Fetching content via Jina Reader...
✅ Extraction successful. Length: 5234 chars.
🧪 Running Scoring Engine...

================ DRY RUN RESULT ================
Title: "AI-powered coding assistants reshape software..."
Status: ✅ PASSED
Total Score: 25
Matched Keywords: AI, LLM, GitHub Copilot
Category Breakdown:
  - Core_AI: 13
  - Dev_Tools: 12
================================================
```

## Test Suite

11 テストスイート、75+ テストケース:

| Suite | Coverage |
|:---|:---|
| `scorer.test.ts` | スコアリングエンジン、除外ルール、鮮度計算 |
| `config_schema.test.ts` | Zod スキーマバリデーション |
| `semantic_dedup.test.ts` | セマンティック重複排除 |
| `keyword_expansion.test.ts` | キーワード拡張候補 |
| `quality_checker.test.ts` | 品質チェッカー |
| `markdown_builder.test.ts` | Markdown 生成 + Frontmatter |
| `obsidian_linker.test.ts` | Obsidian Wiki リンク |
| `plugin_registry.test.ts` | プラグインレジストリ + Event Bus |
| `metrics.test.ts` | メトリクス収集 + コスト計算 |
| `feed_generator.test.ts` | Atom フィード生成 |
| `golden_regression.test.ts` | 出力品質の回帰テスト |

## Troubleshooting

| Problem | Solution |
|:---|:---|
| `GEMINI_API_KEY must be set` | `.env` に API キーを設定 |
| Jina Reader タイムアウト | ネットワーク確認。自動 3 回リトライ |
| 全記事がフィルタされる | `daily_threshold_score` を下げる or `threshold` を調整 |
| GitHub Actions で push 失敗 | `PAT_GITHUB` に `repo` スコープがあるか確認 |
| Raindrop 重複処理 | `archive_collection_id` を設定 |
| LLM プロバイダー全滅 | Circuit Breaker の cooldown (5 分) 待ち、またはキー確認 |
| SQLite WAL エラー | `pipeline_state.db-wal` / `-shm` を削除して再実行 |

## AI Agent Conventions

- 一時ファイルは `_tmp_ai/` に出力 (プロジェクトルート不可)
- Agent ルールは `AGENTS.md` を参照
- ワークフロー: `.agents/workflows/` 配下
