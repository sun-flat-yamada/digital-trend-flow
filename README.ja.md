# Digital Trend Flow

[English](./README.md) | [日本語](./README.ja.md)

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript_5.9-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
![License](https://img.shields.io/badge/License-Private-red)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](../../actions)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sun.flat.yamada)

> 7 種類のソースから毎日情報を収集し、**Map-Reduce パイプライン**で LLM 要約を生成、Obsidian ナレッジベースへ自動蓄積するシステム。

## Architecture

```txt
 RSS ─ Raindrop ─ X/Grok ─ HackerNews ─ arXiv ─ YouTube ─ GitHub Trending
                        ↓ Ingestion
                  Jina Reader (Markdown 抽出)
                        ↓ Filtering
             Scorer + Semantic Dedup + LLM Judge
                        ↓ Map
              Gemini Flash → Facts + 出典 URL
                        ↓ Reduce
              Gemini Pro → TOP 1+3 Summary (JA)
                        ↓ Quality Gate
              Automated Quality Checker (100pt)
                        ↓ Publish
   Obsidian ─ note.com ─ Discord ─ Slack ─ Teams ─ Atom Feed ─ GitHub Pages
```

**なぜ Map-Reduce?** → Flash で事前圧縮 → Pro で統合。コスト 1/10 以下、品質安定化。

## Quick Start

```bash
git clone https://github.com/sun-flat-yamada/digital-trend-flow.git
cd digital-trend-flow
npm install
cp .env.example .env   # GEMINI_API_KEY を設定
```

```bash
npm test                                          # 型チェック + 設定検証 + テスト (75+ tests)
npm run debug:filter "https://example.com/ai/"    # Dry-run (LLM 不要)
npm run build && npm start                        # フルパイプライン実行
```

> [!TIP]
> 最低限 `GEMINI_API_KEY` のみで動作。未設定のソースは自動スキップされます。

## Key Features

| Feature                   | Description                                                           |
| :------------------------ | :-------------------------------------------------------------------- |
| **7 Source Types**        | RSS, Raindrop.io, X/Grok, HackerNews, arXiv, YouTube, GitHub Trending |
| **5 Purpose Categories**  | AI 研究・開発ツール・ビジネス・地政学・手動キュレーション             |
| **Multi-LLM Fallback**    | Google Gemini → OpenAI → Anthropic (Circuit Breaker 付き)             |
| **Auto Model Resolution** | `latest-flash` / `latest-pro` で常に最新 Gemini モデルを自動選択      |
| **Plugin Architecture**   | Event Bus + Registry でソース/パブリッシャーを拡張可能                |
| **Quality Gate**          | 出力品質を 100pt スケールで自動評価、回帰テスト付き                   |
| **Observability**         | トークン/コスト/レイテンシ追跡、Langfuse 連携、GitHub Actions Summary |
| **Smart Dedup**           | SQLite 状態管理 (TTL 90 日) + セマンティック重複排除                  |
| **Obsidian Native**       | Frontmatter, Wiki リンク, DataView 対応 Markdown 生成                 |

## Automation

| Workflow             | Schedule (JST)  | Description                                 |
| :------------------- | :-------------- | :------------------------------------------ |
| `daily_summary.yml`  | 毎日 04:00      | 日次サマリー + artifacts repo へ push       |
| `monthly_digest.yml` | 毎月 1 日 04:30 | 月次ダイジェスト + トレンド分析             |
| `yearly_report.yml`  | 1/1 05:00       | 年次レポート                                |
| `on_demand.yml`      | —               | `workflow_dispatch` / `repository_dispatch` |

## Project Structure

```txt
src/
├── core/           # Config, Types (Zod), Paths, Metrics, Langfuse, Plugin Registry
├── ingestion/      # 7 Source Adapters + Jina Reader + SQLite State Manager
├── filtering/      # Scorer, Semantic Dedup, Keyword Expansion, LLM Judge
├── summarization/  # Map/Reduce, LLM Gateway (multi-provider), Model Resolver
├── aggregation/    # Monthly Digest, Trend Analyzer
├── evaluation/     # Quality Checker (automated)
├── storage/        # Markdown Builder (Frontmatter), Obsidian Linker
├── publishing/     # Discord, Slack, Teams, note.com, Atom Feed
└── cli/            # debug:filter, test_config
```

## Documentation

| Document                               | Content                                                |
| :------------------------------------- | :----------------------------------------------------- |
| [Architecture](docs/architecture.md)   | パイプライン詳細、Map-Reduce 戦略、データフロー        |
| [Configuration](docs/configuration.md) | `config.yml` リファレンス、環境変数、GitHub Secrets    |
| [Settings & Limits](docs/settings.md)  | 実行リミット、レート制限、リトライ、GitHub Variables   |
| [Sources](docs/sources.md)             | 全 7 ソースの設定・認証・カスタマイズ                  |
| [Deployment](docs/deployment.md)       | CI/CD、スケジュール、artifacts リポジトリ運用          |
| [Development](docs/development.md)     | ローカル開発、テスト、デバッグ、トラブルシューティング |

## Tech Stack

**Runtime**: Node.js 24+ · TypeScript 5.9 (Strict + `noUncheckedIndexedAccess`)
**LLM**: Google Gemini · OpenAI · Anthropic (via unified gateway)
**Data**: better-sqlite3 (WAL mode) · Zod 4 validation · YAML config
**Infra**: GitHub Actions · Langfuse · ESLint 10 (flat config)

---

## 🤝 Contribution & Support

Contributions are welcome! If you find this tool useful, please consider supporting its development.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sun.flat.yamada)

---

Built by [Youhei Yamada](https://github.com/sun-flat-yamada) · [Security Policy](SECURITY.md)
