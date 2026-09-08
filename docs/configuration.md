# Configuration

## config.yml

パイプライン全体の動作を定義する中心的な設定ファイルです。

### Global Settings

```yaml
version: "2.0"
settings:
  daily_threshold_score: 0          # システム全体の最低基準スコア
  models:
    platform: "google"              # Primary LLM プロバイダー
    map: "latest-flash"             # Map フェーズモデル (auto-resolve 対応)
    reduce: "latest-pro"            # Reduce フェーズモデル
    thinking: false                 # Thinking model (Gemini 2.5+)
  author: "Youhei Yamada"
  freshness:
    enabled: true                   # 鮮度スコアリング
    decay_lambda: 0.02              # 指数減衰係数
    max_age_hours: 72               # 最大経過時間
  state_ttl_days: 90                # 処理済み URL の TTL
  llm_judge:
    enabled: false                  # LLM-as-a-Judge (コスト注意)
    weight: 0.5                     # キーワードスコアとの混合比率
  semantic_dedup:
    enabled: true
    similarity_threshold: 0.75      # タイトル類似度閾値
  language: "en"                    # 出力言語 (デフォルト: "en", GitHub Variables で上書き可能)
```

### Fallback Models (Optional)

```yaml
settings:
  fallback_models:
    platform: "openai"
    map: "gpt-4.1-mini"
    reduce: "gpt-4.1"
```

### Purpose Categories

各カテゴリに情報源・スコアリングルール・クォータを定義:

```yaml
purposes:
  ai_research:
    label: 🔬 AI・LLM 研究
    priority: 1                          # 表示順 (小さいほど上位)
    quota: { min: 2, max: 5 }            # レポート内の記事数制限
    scoring:
      threshold: 8                       # 足切りスコア
      title_multiplier: 2                # タイトル内キーワードの加算倍率
      keywords:
        - { word: transformer, weight: 12 }
        - { word: LLM, weight: 8 }
    sources: [...]                       # → docs/sources.md 参照
```

> `scoring: null` を指定するとグローバルキーワードで自動分類されます (例: `curated` カテゴリ)。

### Exclude Rules

```yaml
exclude:
  domains: [prtimes.jp, prnewswire.com]  # ドメイン単位ブロック
  keywords: ["PR:", Sponsored]            # NG ワード除外
  url_strip_parameters: [utm_source]      # URL 正規化パラメータ
  content_length: { min: 200, max: 50000 } # 文字数制限
```

---

## Environment Variables

### Required

| Variable | Description | Source |
|:---|:---|:---|
| `GEMINI_API_KEY` | Google Gemini API Key | [Google AI Studio](https://ai.google.dev/) |

### Optional — Ingestion

| Variable | Description | Source |
|:---|:---|:---|
| `RAINDROP_TEST_TOKEN` | Raindrop.io ブックマーク取得 | [Raindrop 統合設定](https://app.raindrop.io/settings/integrations) |
| `XAI_API_KEY` | X/Twitter 検索 (Grok) | [xAI Console](https://console.x.ai/) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 | [Google Cloud Console](https://console.cloud.google.com/) |
| `FIRECRAWL_API_KEY` | 代替コンテンツ抽出 | [Firecrawl](https://firecrawl.dev/) |

### Optional — LLM Fallback

| Variable | Description |
|:---|:---|
| `OPENAI_API_KEY` | OpenAI API (フォールバック) |
| `ANTHROPIC_API_KEY` | Anthropic API (フォールバック) |

### Optional — Publishing

| Variable | Description |
|:---|:---|
| `NOTE_API_TOKEN` | note.com 配信 |
| `DISCORD_WEBHOOK_URL` | Discord 通知 |
| `SLACK_WEBHOOK_URL` | Slack 通知 |
| `TEAMS_WEBHOOK_URL` | Teams 通知 |

### Optional — Observability

| Variable | Description |
|:---|:---|
| `LANGFUSE_PUBLIC_KEY` | Langfuse トレーシング |
| `LANGFUSE_SECRET_KEY` | Langfuse Secret |
| `LANGFUSE_HOST` | Langfuse ホスト URL |

---

## GitHub Secrets (CI/CD)

`Settings > Secrets and variables > Actions` に登録:

| Secret | Required | Note |
|:---|:---|:---|
| `GEMINI_API_KEY` | ✅ | Primary LLM |
| `PAT_GITHUB` | ✅ | `repo` スコープ (Fine-grained: Contents Read/Write) |
| Other keys | — | 上記 Optional 変数と同名で登録 |

> [!IMPORTANT]
> デフォルトの `GITHUB_TOKEN` ではワークフローからの `git push` が許可されないため、`PAT_GITHUB` が必要です。

---

## GitHub Variables (CI/CD)

並列実行数やレート制限インターバルの調整用。詳細は [Settings & Limits Guide](settings.md) を参照:

| Variable | Default | Note |
|:---|:---|:---|
| `API_CONCURRENCY` | `1` | 並列リクエスト数 (Free Tier: 1, Paid: 5) |
| `API_INTERVAL_MS` | `13000` | リクエスト間遅延ミリ秒 (Free Tier: 13000 = ~4.6 RPM) |
