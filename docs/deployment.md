# Deployment

## GitHub Actions

### Workflow Schedule

| Workflow | Cron (UTC) | JST | Trigger |
|:---|:---|:---|:---|
| `daily_summary.yml` | `0 19 * * *` | 毎日 04:00 | Full pipeline + git push |
| `monthly_digest.yml` | `30 19 1 * *` | 毎月 1 日 04:30 | 月次ダイジェスト |
| `yearly_report.yml` | `0 20 1 1 *` | 1/1 05:00 | 年次レポート |
| `on_demand.yml` | — | — | `workflow_dispatch` / `repository_dispatch` |

全ワークフローは `workflow_dispatch` による手動トリガーも可能。

### 手動実行

GitHub → **Actions** タブ → ワークフロー選択 → **Run workflow**

### Artifacts Repository

生成されたサマリーは **別リポジトリ** (`sun-flat-yamada/artifacts`) に push されます。

```txt
daily_summary.yml
  ├── Checkout: digital-trend-flow (本体)
  ├── Checkout: artifacts repo → ./artifacts/
  ├── npm ci → type-check → build → start
  ├── Commit & push: artifacts/ → artifacts repo
  └── Commit & push: pipeline_state.db → 本体 repo
```

**必要な Secret**: `PAT_GITHUB` (`repo` スコープ)

### Job Summary

パイプライン実行後、GitHub Actions の **Summary** タブにメトリクスが自動出力されます:

- 取得/スコアリング/選定された記事数
- LLM コール数 (Map/Reduce/Judge)
- トークン消費量・推定コスト
- ソース別ステータス
- カテゴリ別記事分布

---

## Infrastructure Requirements

| Component | Requirement |
|:---|:---|
| **Runner** | `ubuntu-latest` |
| **Node.js** | 24+ |
| **Timeout** | 30 分 |
| **Permissions** | `contents: write` |

## Security

- 全 Secret は `process.env` 経由で Zod バリデーション (`EnvSchema`)
- ハードコードされた API キーは一切なし
- CI/CD では GitHub Repository Secrets を使用
- → [Security Policy](../SECURITY.md)
