# Deployment

## GitHub Actions

### Workflow Schedule

| Workflow | Cron (UTC) | JST | Trigger |
|:---|:---|:---|:---|
| `daily_summary.yml` | `47 18 * * *` | 毎日 03:47 | Full pipeline + git push。`repository_dispatch`（`trigger-digest`）にも対応 |
| `weekly_digest.yml` | `17 2 * * 1` | 毎週月曜 11:17 | 前週（ISO 週）の週次レポート |
| `monthly_digest.yml` | `30 19 1 * *` | 毎月 2 日 04:30 | 前月の月次ダイジェスト |
| `yearly_report.yml` | `43 20 2 1 *` | 1/3 05:43 | 前年の年次レポート（12 月分の月次ダイジェストの翌日） |

全ワークフローは `workflow_dispatch` による手動トリガーも可能。週次・月次・年次は対象期間（`2026-W42`・`2026-09`・`2026`）を入力でき、空なら直前の期間になる。

- 日次の起動時刻は毎時 0 分を避けている（GitHub の定時実行は 0 分に集中し、遅延・欠落しやすい）。
- 日次を手動実行するときは `dry_run` を選べる。記事の選定まで行って停止し、LLM による要約・配信・コミット・Pages デプロイは行わない。
- 日次・週次・月次・年次は同じ concurrency グループ（`pipeline-state`）に属し、`pipeline_state.db` と artifacts リポジトリを更新する実行が重ならない。
- push はリモートが進んでいれば rebase して最大 3 回再試行し、それでも失敗したらジョブを失敗させる。
- 週次・月次・年次のレポートは生成後に通知・Zenn・note.com へ配信され、artifacts リポジトリにコミットされる。Pages には次の日次実行のサイト生成で載る。
- 日次は `pipx install edge-tts` で Podcast の音声合成を有効にする（失敗しても台本だけで続行する）。
- `vars.ZENN_REPO` を設定すると、各ワークフローが新しい Zenn 記事を Zenn 連携リポジトリの `articles/` に push する（composite action `.github/actions/sync-zenn`）。
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
- トリアージの結果 (残した件数・落とした件数・トークン数・コスト。失敗時は fallback)
- LLM コール数 (Triage/Map/Reduce)
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
