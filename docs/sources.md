# Information Sources

9 種類のソースアダプターを備えています。API キーが未設定のソースは自動スキップされます。

## Source Types

### RSS (`rss.ts`)

標準的な RSS/Atom フィードからの記事取得。認証不要。

```yaml
- type: rss
  name: "Hugging Face Daily Papers"
  url: "https://huggingface.co/papers/rss.xml"
```

### Raindrop.io (`raindrop.ts`)

手動キュレーションしたブックマークの取得。3 層重複排除 (日付カットオフ + State DB + アーカイブ移動)。

```yaml
- type: raindrop
  name: "Raindrop Inbox"
  collection_id: -1                    # -1 = Unsorted
  archive_collection_id: 12345678      # 処理済みアイテムの移動先
  lookback_hours: 48
```

**セットアップ**:

1. Raindrop.io で「HQ Processed」コレクションを作成
2. URL から ID を取得 (`https://app.raindrop.io/my/12345678` → `12345678`)
3. `archive_collection_id` に設定

**Auth**: `RAINDROP_TEST_TOKEN`

### X/Twitter via Grok (`xai_grok.ts`)

xAI Grok の `x_search` 機能でリアルタイム X 検索。公式 Twitter API (Enterprise tier) 不要。

```yaml
- type: xai_grok
  name: "X AI Trends via Grok"
  query: "AI OR LLM min_faves:100 (lang:ja OR lang:en)"
```

**Auth**: `XAI_API_KEY`

### Hacker News (`hackernews.ts`)

HN のトップストーリーをスコアベースでフィルタリング。認証不要。

```yaml
- type: hackernews
  name: "Hacker News Top Stories"
  min_score: 150                       # 最低スコア
  max_items: 20                        # 取得上限
```

### arXiv (`arxiv.ts`)

arXiv API による学術論文検索。認証不要。

```yaml
- type: arxiv
  name: "arXiv AI Papers"
  query: "cat:cs.AI OR cat:cs.CL OR cat:cs.LG"
  max_results: 15
```

### YouTube (`youtube.ts`)

YouTube Data API v3 でチャンネル/検索ベースの動画取得。

```yaml
- type: youtube
  name: "AI YouTube Channels"
  channel_id: "UC..."                  # または query で検索
  query: "AI research"
  max_results: 10
```

**Auth**: `YOUTUBE_API_KEY`

### GitHub Trending (`github_trending.ts`)

GitHub Trending リポジトリのスクレイピング。認証不要。

```yaml
- type: github_trending
  name: "GitHub Trending (Python)"
  language_filter: python              # 言語フィルター
  since: daily                         # daily / weekly / monthly
```

### Reddit (`reddit.ts`)

公開 JSON API によるコミュニティ（`r/LocalLLaMA`, `r/MachineLearning` 等）のホット投稿取得。認証不要。

```yaml
- type: reddit
  name: "Reddit r/LocalLLaMA"
  subreddit: "LocalLLaMA"
  min_score: 100                       # 最低Upvoteスコア
  max_items: 15
```

### Bluesky (`bluesky.ts`)

Bluesky AT Protocol 公開 AppView API (`public.api.bsky.app`) による技術キーワード検索。認証不要。

```yaml
- type: bluesky
  name: "Bluesky AI Trends"
  query: "AI OR LLM"
  min_likes: 30                        # 最低Like数
  max_items: 15
```

---

## Deduplication Strategy

全ソース共通で `state_manager.ts` (SQLite) による URL ベースの重複排除が適用されます。

| Source | Additional Dedup |
|:---|:---|
| Raindrop | 日付カットオフ + State DB + アーカイブ移動 (3 層) |
| Others | State DB のみ (TTL: 90 日、設定可能) |

## Source Health Monitoring

- 各ソースの取得状態 (`ok` / `empty` / `error`) を SQLite に記録
- **連続 3 日以上** 0 件のソースは自動アラート
- Metrics JSON / GitHub Actions Summary で可視化

## 到達性チェック (`npm run check:sources`)

`config.yml` の全情報源に 1 回ずつアクセスし、到達できるか・何件返るか・所要時間を表にします。状態 DB (`pipeline_state.db`) は読み書きせず、LLM も Jina も呼びません。

```bash
npm run check:sources                                   # 全情報源
npm run check:sources -- https://example.com/feed.xml   # 差し替え候補の RSS も試す
```

- 表は「有効」「無効 (`enabled: false`)」「候補 (引数の URL)」の欄に分かれます。無効な情報源も検査するので、復旧したら分かります
- API キーが必要で未設定の情報源は `skipped` と表示します
- Detail 列にエラー (`Status code 429` など) が出ます
- 有効な情報源が 1 件でも失敗すると終了コード 1 になります。無効な情報源と候補は終了コードに影響しません
- GitHub Actions では `.github/workflows/source_check.yml` が毎週日曜 JST 06:23 に実行し、結果を Job Summary に出します。手動実行 (`workflow_dispatch`) では `urls` に空白区切りで候補 URL を渡せます

## カスタムソースの追加

→ [`.agents/workflows/add-source.md`](../.agents/workflows/add-source.md) を参照
