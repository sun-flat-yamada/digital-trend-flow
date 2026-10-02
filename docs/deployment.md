# Deployment

## GitHub Actions

### Workflow Schedule

| Workflow | Cron (UTC) | JST | Trigger |
|:---|:---|:---|:---|
| `daily_summary.yml` | `47 18 * * *` | 毎日 03:47 | Full pipeline + git push。`repository_dispatch`（`trigger-digest`）にも対応 |
| `monthly_digest.yml` | `30 19 1 * *` | 毎月 2 日 04:30 | 前月の月次ダイジェスト |
| `yearly_report.yml` | `0 20 1 1 *` | 1/1 05:00 | 年次レポート |

全ワークフローは `workflow_dispatch` による手動トリガーも可能。

- 日次の起動時刻は毎時 0 分を避けている（GitHub の定時実行は 0 分に集中し、遅延・欠落しやすい）。
- 日次を手動実行するときは `dry_run` を選べる。記事の選定まで行って停止し、LLM による要約・配信・コミット・Pages デプロイは行わない。
- 日次と月次は同じ concurrency グループ（`pipeline-state`）に属し、`pipeline_state.db` と artifacts リポジトリを更新する実行が重ならない。
- push はリモートが進んでいれば rebase して最大 3 回再試行し、それでも失敗したらジョブを失敗させる。
- Atom フィードは Pages サイトの `feed.xml` として公開される。リンク先は `vars.PAGES_BASE_URL`、未設定なら `https://<owner>.github.io/<repo>/`。

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
