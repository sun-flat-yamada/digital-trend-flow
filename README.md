# Digital Trend Flow

[English](./README.md) | [日本語](./README.ja.md)

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript_5.9-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
![License](https://img.shields.io/badge/License-Private-red)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](../../actions)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sun.flat.yamada)

> An automated system that collects information from 7 types of sources daily, generates LLM summaries via a **Map-Reduce pipeline**, and automatically accumulates them in an Obsidian knowledge base.

## Architecture

```txt
 RSS ─ Raindrop ─ X/Grok ─ HackerNews ─ arXiv ─ YouTube ─ GitHub Trending
                        ↓ Ingestion
                  Jina Reader (Markdown Extraction)
                        ↓ Filtering
             Scorer + Semantic Dedup + LLM Judge
                        ↓ Map
              Gemini Flash → Facts + Source URLs
                        ↓ Reduce
              Gemini Pro → TOP 1+3 Summary (JA)
                        ↓ Quality Gate
              Automated Quality Checker (100pt)
                        ↓ Publish
   Obsidian ─ note.com ─ Discord ─ Slack ─ Teams ─ Atom Feed ─ GitHub Pages
```

**Why Map-Reduce?** → Pre-compression with Flash → Integration with Pro. Reduces cost to less than 1/10 and stabilizes quality.

## Quick Start

```bash
git clone https://github.com/sun-flat-yamada/digital-trend-flow.git
cd digital-trend-flow
npm install
cp .env.example .env   # Configure GEMINI_API_KEY
```

```bash
npm test                                          # Type check + Config validation + Tests (75+ tests)
npm run debug:filter "https://example.com/ai/"    # Dry-run (No LLM required)
npm run build && npm start                        # Full pipeline execution
```

> [!TIP]
> Operates with only `GEMINI_API_KEY` at a minimum. Unconfigured sources are automatically skipped.

## Key Features

| Feature                   | Description                                                                       |
| :------------------------ | :-------------------------------------------------------------------------------- |
| **7 Source Types**        | RSS, Raindrop.io, X/Grok, HackerNews, arXiv, YouTube, GitHub Trending             |
| **5 Purpose Categories**  | AI Research, Development Tools, Business, Geopolitics, Manual Curation            |
| **Multi-LLM Fallback**    | Google Gemini → OpenAI → Anthropic (with Circuit Breaker)                         |
| **Auto Model Resolution** | Automatically selects the latest Gemini models with `latest-flash` / `latest-pro` |
| **Plugin Architecture**   | Extensible sources/publishers via Event Bus + Registry                            |
| **Quality Gate**          | Automated quality evaluation on a 100pt scale, with regression tests              |
| **Observability**         | Token/Cost/Latency tracking, Langfuse integration, GitHub Actions Summary         |
| **Smart Dedup**           | SQLite state management (90-day TTL) + Semantic deduplication                     |
| **Obsidian Native**       | Generates Markdown compatible with Frontmatter, Wiki links, and DataView          |

## Automation

| Workflow             | Schedule (JST)     | Description                                 |
| :------------------- | :----------------- | :------------------------------------------ |
| `daily_summary.yml`  | Daily 04:00        | Daily summary + push to artifacts repo      |
| `monthly_digest.yml` | 1st of month 04:30 | Monthly digest + Trend analysis             |
| `yearly_report.yml`  | Jan 1st 05:00      | Yearly report                               |
| `on_demand.yml`      | —                  | `workflow_dispatch` / `repository_dispatch` |

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

| Document                               | Content                                                            |
| :------------------------------------- | :----------------------------------------------------------------- |
| [Architecture](docs/architecture.md)   | Pipeline details, Map-Reduce strategy, Data flow                   |
| [Configuration](docs/configuration.md) | `config.yml` reference, Env vars, GitHub Secrets                   |
| [Settings & Limits](docs/settings.md)  | Execution limits, Rate limiting, Retries, GitHub Variables         |
| [Sources](docs/sources.md)             | Configuration, authentication, and customization for all 7 sources |
| [Deployment](docs/deployment.md)       | CI/CD, schedules, artifacts repository operations                  |
| [Development](docs/development.md)     | Local development, testing, debugging, troubleshooting             |

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
