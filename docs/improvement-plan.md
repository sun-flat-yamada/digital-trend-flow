# Digital Trend Flow 改善計画（リポジトリ全体レビュー）

> **要旨**
> GitHub Actions 上では毎日「成功」しているが、**2026-09-23 以降の 8 回連続で Map フェーズ（記事本文からの事実抽出）が 100% 失敗**している。その結果、記事本文を一切読まずに**タイトルだけから生成された要約**が、品質スコア 100 点のまま Discord・GitHub Pages・artifacts リポジトリへ配信されている。
> また **15 ソース中 8 ソースが、記録のある 23 日間すべてで 0 件**を返しているが、障害アラートは一度も発火していない。
> どちらも「エラーを握りつぶして成功に見える値へ変換する」実装パターンが根本原因である。品質ゲート・テスト・Lint が重要経路をカバーしていないため、発見もされていない。本書はその是正を最優先とし、その後に信頼性・選定品質・開発基盤・アーキテクチャを段階的に改善する計画を示す。

| 項目 | 内容 |
| :-- | :-- |
| 作成日 | 2026-10-01 |
| 対象 | `main` @ `4487d91`（2026-09-30 時点） |
| レビュー範囲 | `src/` 45 ファイル（9,311 行）、`tests/` 22 ファイル（2,441 行）、`.github/workflows/` 5 本、`config.yml`、`prompts/`、`docs/`・`README*`・`AGENTS.md`・`.agents/` |
| 実運用データ | 同梱 `pipeline_state.db`（実行 25 回 / 23 日分、`source_health` 345 行）の読み取り専用コピー、Daily Trend Summary [run #28](https://github.com/sun-flat-yamada/digital-trend-flow/actions/runs/36787339790)（2026-09-30 実行分）のジョブログ |
| 実行検証 | `tsc --noEmit` ✅ / `eslint .` ✅ / `npm run test:config` ✅ / `jest` 22 スイート・134 件 ✅ / `npm audit` high 1 件 |

重要度は次のように定義する。

- **P0**: 現在進行形で出力品質またはセキュリティに実害・重大リスクがある。即時対応
- **P1**: 正しさ・信頼性の欠陥。2 週間以内
- **P2**: 品質・保守性の改善。1 ヶ月以内
- **P3**: 中長期の改善

## 目次

1. [現状スナップショット](#1-現状スナップショット)
2. [良い点（維持すべき資産）](#2-良い点維持すべき資産)
3. [重大な発見事項（P0）](#3-重大な発見事項p0)
4. [領域別の指摘一覧](#4-領域別の指摘一覧)
5. [改善ロードマップ](#5-改善ロードマップ)
6. [KPI](#6-kpi)
7. [設計方針の提案](#7-設計方針の提案)
8. [PR 分割案](#8-pr-分割案)
9. [付録 A: 調査方法と根拠](#付録-a-調査方法と根拠)
10. [付録 B: 前提・未確認事項](#付録-b-前提未確認事項)

---

## 1. 現状スナップショット

### 1.1 パイプライン実行（`pipeline_runs`: 2026-09-07〜09-30、25 回）

| 指標 | 値 | 備考 |
| :-- | :-- | :-- |
| Map 呼び出しが 1 件も成功しなかった実行 | **10 / 25 回** | 09-07（1 回目）、09-08、09-23〜09-30（直近 **8 回連続**） |
| 上記の実行に付いた品質スコア | 70〜100 | 09-25 以降の 6 回はすべて **100** |
| 1 回あたりの推定 LLM コスト | 約 $0.01 | 25 回累計で約 $0.26 |
| 定期実行の開始時刻 | 21:08〜23:36 UTC（06:08〜08:36 JST） | 予定は 19:00 UTC（04:00 JST）。2〜4.5 時間遅延 |
| 直近実行の所要時間（09-30） | 13 分 48 秒 | うち本文抽出＋スコアリング 11 分 00 秒、Map 2 分 30 秒、Reduce 15 秒 |

### 1.2 情報源（`source_health`: 15 ソース × 23 日）

| 状態 | ソース | 09-30 実行ログ上の原因 |
| :-- | :-- | :-- |
| 23 日すべて 0 件 | Reuters Technology | `getaddrinfo ENOTFOUND feeds.reuters.com` |
| 〃 | VentureBeat | HTTP 429 |
| 〃 | Hugging Face Daily Papers | HTTP 401 |
| 〃 | Ledge.ai | HTTP 404 |
| 〃 | Reddit r/LocalLLaMA | HTTP 403 |
| 〃 | Bluesky AI Trends | HTTP 403 |
| 〃 | X via Grok | `XAI_API_KEY` 未設定 |
| 〃 | Raindrop Inbox | `RAINDROP_TEST_TOKEN` 未設定 |
| 稼働 | arXiv / GitHub Trending / Hacker News / BBC / Forbes / Newsweek / The Conversation | — |

- 稼働率は **7/15（47%）**。8 ソースとも `status` は `error` ではなく `empty` として記録されている
- 連続失敗アラートの算出値は 8 ソースとも **0 日**（実際は 23 日連続）。本番 DB に対して判定ロジックを再現して確認した

### 1.3 選定結果（09-30 実行ログ）

- 取得 132 件 → タイトル事前選別でスキップ 31 件 → Jina で本文取得 101 件（うち **36 件は 4 回試行後に失敗**: Forbes のタイムアウト、Newsweek の 403）→ スコア通過 33 件 → 選定 10 件
- 通過 33 件の内訳は **政治・地政学 26** / AI・LLM 研究 3 / 開発ツール 3 / ビジネス 1
  - 地政学の通過記事には「Fat Bear Week の優勝熊」「俳優の家族の訃報」「遊園地のコースター閉鎖」「ヨットがクジラに破壊された夫婦」など、明らかな対象外が少なくとも 10 件ある
- 一方で次のような AI 関連記事が、本文取得前のタイトル事前選別で除外されている
  - 「Gemini 4 Argon (HN: 744pts)」
  - 「You said no MCP (HN: 577pts)」
  - 「AdviSD: Learning to Advise Frontier LLMs via …」
  - 「Thinking Before Thinking: Scaling Agentic Inference …」
- `processed_urls` 210 件の目的別内訳は 地政学 75 / ビジネス 67 / 開発ツール 43 / AI 研究 25。AI 系 2 目的の合計は 32%

### 1.4 コード品質ゲート

| 項目 | 状態 |
| :-- | :-- |
| 型チェック | ✅ `strict`・`noUncheckedIndexedAccess`・`exactOptionalPropertyTypes` |
| ESLint | ✅ ただし対象は JSON・YAML など 11 ファイルのみで、**TypeScript は 0 ファイル**（`eslint src/main.ts` → "File ignored because no matching configuration was supplied"） |
| テスト | ✅ 22 スイート・134 件・3.6 秒。ただし **22 ファイル・2,985 行がどのテストからも読み込まれていない**（`main.ts`、`state_manager.ts`、`gemini_map.ts`、`gemini_reduce.ts`、`jina_reader.ts`、ingestion の大半など） |
| PR 時の CI | **なし**（Dependabot PR も無検証でマージ可能） |
| 依存の脆弱性 | `npm audit`: high 1 件（`brace-expansion`、devDependency 経由、修正版あり） |
| 非推奨依存 | `@google/generative-ai` 0.24.1（README で Deprecated、2025-08-31 にサポート終了と明記） |

---

## 2. 良い点（維持すべき資産）

- Zod による設定・環境変数の fail-fast 検証と、`discriminatedUnion` によるソース定義の型安全性
- TypeScript の厳格設定（`exactOptionalPropertyTypes` まで有効）
- Map-Reduce によるコスト設計が機能している（実績で約 $0.01/日）
- ソース単位の障害分離（`Promise.allSettled`）、LLM の多段フォールバック、Circuit Breaker という設計意図
- `pipeline_runs` / `source_health` に実行履歴を残していること。**本レビューの定量分析はこのデータがあったからこそ可能だった**
- 高速なテストスイート、充実したドキュメントとエージェント向けルール、Dependabot・CODEOWNERS・SECURITY.md
- 出力の多言語化、Obsidian 互換のフロントマター、GitHub Pages による公開

---

## 3. 重大な発見事項（P0）

### F-01 モデル自動解決が TTS 専用モデルを選び、Map が 100% 失敗している

- **症状**: 09-23 以降、`latest-flash-lite` が `gemini-3.8-flash-lite-tts` に解決される。全 Map 呼び出しが `[400 Bad Request] Developer instruction is not enabled for this model` で失敗している（09-23 は無料枠の 429）
- **根拠**
  - 09-30 ログに `🤖 Auto-resolved latest-flash-lite on google to -> gemini-3.8-flash-lite-tts`
  - `metrics_json` 上、09-25 以降の `llm_calls` は reduce の 1 件のみ
  - 09-10〜09-22 は `gemini-3.5-flash-lite` で正常に動作していた
- **原因**: `src/summarization/model_resolver.ts:64-78` は、モデル名に `lite` を含むかとバージョン番号だけで選んでいる。`supportedGenerationMethods` もモダリティ派生（`-tts`・`-image`・`-audio`・`-live`・`embedding` など）も考慮していない。`tests/model_resolver.test.ts` にも派生モデルが混在するケースがない
- **対応**
  - 即時（コード変更なし）: リポジトリ変数 `AI_MODEL_MAP=gemini-3.5-flash-lite` を設定する。`src/core/config.ts:53-73` の上書きが効く
  - 恒久: 解決ロジックを「`generateContent` 対応、派生モデルを除外、失敗時は次の候補へ」に直す。または本番では明示的なモデル ID を固定し、自動解決は検証用に限る

### F-02 失敗が「成功に見える出力」へ変換され、劣化した要約がそのまま配信される

F-01 が発見されなかった理由である。各層が失敗を握りつぶし、次の連鎖で劣化がそのまま公開される。

1. `src/summarization/llm_gateway.ts:423-426` は 400/401/403 を `metrics.recordError` せずに再スローする。次のプロバイダーやモデルへのフォールバックもしない（モデル非互換による 400 も含む）
2. `src/summarization/gemini_map.ts:96-104` は例外をすべて捕捉し、`facts: [{ text: "(Extraction failed for this article)" }]` を返す
3. `src/main.ts:401-417` はプレースホルダーも抽出成功として数え（ログ: `→ Extracted facts from 10 articles.`）、Reduce に渡す
4. Reduce はタイトルと失敗プレースホルダーだけから 5,000 字超の分析を生成する。本文に基づかないため、ハルシネーションの温床になる。Reduce も失敗した場合は `src/summarization/gemini_reduce.ts:87-112` の "Fallback Mode"（プレースホルダーの羅列）が本文になる
5. `src/evaluation/quality_checker.ts` は書式・文字数・URL の出現しか見ないため 100 点になる。`src/main.ts:446-460` は品質スコアを記録するだけで、公開の判定に使っていない（`docs/architecture.md` の "Quality Gate → Pass?" は未実装）
6. `src/main.ts:538-566` は Discord 配信・Pages 生成の後、選定した全 URL を `markAsProcessed` する。翌日以降も再処理されず、劣化は回復しない
7. GitHub Actions の結果はすべて success になる

- **影響**: 09-23〜09-30 の 8 日分を含む 10 回分の日次サマリーが劣化している。Discord 通知、Pages、Atom フィード、Podcast 台本も同様である。今夜（10-01 19:30 UTC）に定期実行される 9 月の月次ダイジェストも、この劣化データを入力にする
- **対応**: [§5 Phase 0](#phase-0-劣化配信の停止即日2-日p0) を参照（実行ステータス `degraded` の導入、Map 成功率による公開ゲート、未処理扱いでの再試行、ジョブ失敗による通知）

### F-03 Podcast 生成でシェル経由のコマンド実行（コマンドインジェクション）

- `src/publishing/podcast_generator.ts:196-200` は、LLM の生成文（外部記事に由来）を `"` だけエスケープし、`` execSync(`edge-tts ... --text "${escapedText}" ...`) `` に渡している。二重引用符の中でも `$(...)`・バッククォート・`\` はシェルが解釈する
- プロンプトインジェクションで生成文に `$(...)` が混入すると、ランナー上で任意コードが実行される。このプロセスは全シークレット（`GEMINI_API_KEY`、`DISCORD_WEBHOOK_URL`、SMTP 資格情報）を環境変数に持ち、ジョブ中は checkout（`persist-credentials: true`）によって `PAT_GITHUB` も git の資格情報として保持されている
- 現在の Actions ランナーには `edge-tts` がないため発火しない（潜在リスク）。ただし機能を有効化した時点、または `edge-tts` を入れた開発者のローカルで発火し得る
- **対応**: `execFileSync("edge-tts", [...args])`（シェルを経由しない）にするか、`--file` でテキストファイルを渡す

### F-04 GitHub Pages の XSS（生 HTML の素通し）

- `src/publishing/pages_generator.ts:197-336` の `markdownToHtml` は、`<details` / `<summary` で始まる行をエスケープせずに出力する（`:309`、`:323`）
- LLM 出力に `<details open ontoggle=...>` のような行が含まれると、`index.html` の初期表示と `app.js` の `innerHTML` 経由で実行される
- **対応**
  - メトリクス用の固定行（`<details class="pipeline-metrics">` など）の完全一致のみ許可し、それ以外はエスケープする
  - CSP（`default-src 'self'`）を付与する
  - 将来は HTML を無効化した実績ある Markdown レンダラーに置き換える

### F-05 ソース障害が検知されない（15 ソース中 8 ソースが 23 日間 0 件）

- 各アダプターは例外を捕捉して `[]` を返す（`rss.ts:64`、`hackernews.ts:77`、`arxiv.ts:70`、`reddit.ts:87`、`bluesky.ts:111` など）。そのため `src/main.ts:227-249` では常に `fulfilled` となり、`status: "empty"` として記録される（`error` にはならない）
- `src/ingestion/state_manager.ts:255` の連続失敗判定は `status === "error"` か `status === "ok" && article_count === 0` を数える。一方、0 件は `"empty"` で記録される（`main.ts:233`）ため、どちらにも一致しない
- API キー未設定（意図的な無効化）も `empty` として記録され、障害と区別できない
- **対応**: [§5 Phase 1](#phase-1-信頼性と正しさ2-週p1) の 1-1 を参照

---

## 4. 領域別の指摘一覧

### 4.1 取得（Ingestion）

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| ING-1 | P1 | 例外を握りつぶして `[]` を返す（F-05） | `src/ingestion/*.ts` の各 `catch` | ステータス（ok / empty / error / disabled）と件数・エラーを持つ `SourceResult` を返す |
| ING-2 | P1 | `isProcessed` を正規化前の URL で照会しているが、保存は `normalizeUrl` 後の URL（`main.ts:289, 565`）。arXiv は `http://` の `<id>` で照会し、その後に `https://` 化して保存するため、既処理判定が一致しない | `arxiv.ts:56, 63`。本番 DB の arXiv URL は 25 件すべて `https://` | URL 正規化を `core/url.ts` に一元化し、照会・保存とも正規化後の URL で行う |
| ING-3 | P1 | Raindrop は、スコア不足や抽出失敗で採用されなかった項目の ID まで集め、実行後にアーカイブへ移動する。手動でクリップした記事が要約されないまま受信箱から消える | `raindrop.ts:123, 137`、`main.ts:568-573` | 要約に採用された URL の ID だけをアーカイブする |
| ING-4 | P1 | X/Grok のコメントは「`/v1/responses` + `x_search`」だが、実装は検索ツールなしで `/v1/chat/completions` に `grok-3-fast` を投げる。実在しない投稿 URL を生成し得る（URL 形式しか検査しない） | `xai_grok.ts:14-20` と `:88-108` | 検索ツール付きで実装し直すまで無効化する。モデル名は config へ移す |
| ING-5 | P1 | Reddit / Bluesky は GitHub Actions からの未認証アクセスで 403 | 09-30 ログ | Reddit は OAuth（script app）、Bluesky は App Password で認証した API を使う。または対象から外す |
| ING-6 | P1 | RSS 4 本が死んでいる（Reuters / Ledge.ai / HF Daily Papers / VentureBeat） | §1.2 | 代替フィードに差し替え、`npm run check:sources` で定期的に検査する |
| ING-7 | P2 | `ArticleItem` が `rss.ts` に定義され、全モジュールが依存している。タイトルに `(HN: 744pts)`・`⭐ … (★3481/day)`・`🎬 …` などの装飾を埋め込むため、重複排除・キーワード判定・要約の見出しに混入する | `hackernews.ts:66`、`github_trending.ts:74`、`youtube.ts:72` | 型を `core/types.ts` へ移す。エンゲージメント等は `engagement`・`description` などの別フィールドにする |
| ING-8 | P2 | 取得期間（72 時間）がソースごとにハードコードされ、`freshness.max_age_hours` と二重管理になっている | `rss.ts:34`、`youtube.ts:50` | config から注入する |
| ING-9 | P2 | GitHub Trending は正規表現による HTML スクレイピング。説明文の抽出で次のリポジトリの `<p>` を拾い得る | `github_trending.ts:42-68` | HTML パーサーを使うか、GitHub Search API 等へ切り替える |
| ING-10 | P2 | Bluesky の `searchPosts` に `since` 指定がなく、`sort: "top"` で古い投稿が混入し得る | `bluesky.ts:57-68` | `since` を付ける |
| ING-11 | P3 | 同じ URL が複数のソースから来ても、本文取得前に重複排除しない（Jina で二重取得する） | `main.ts:286-355` | 本文取得前に正規化 URL で重複を除く |

### 4.2 本文抽出（Jina Reader）

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| EXT-1 | P1 | 403/404 などの恒久エラーも 4 回試行する（指数バックオフ込みで 1 URL あたり約 54 秒）。09-30 は 36 URL が失敗し、抽出フェーズに 11 分かかった | `jina_reader.ts:63-91`、`core/retry.ts`、ログのタイムスタンプ | 429・5xx・タイムアウトだけを再試行する。ドメイン単位のサーキットブレーカーを入れる |
| EXT-2 | P1 | 抽出失敗が `""` で返り、「Content too short (0 chars)」として除外される。抽出失敗率が計測されない | `jina_reader.ts:89`、ログ | 失敗理由を持つ結果型にしてメトリクス化する |
| EXT-3 | P2 | Jina の API キーに未対応（無認証はレート制限が厳しい）。タイムアウトは 10 秒固定 | `jina_reader.ts:66-69` | `JINA_API_KEY` を `EnvSchema` に追加し、タイムアウトを設定可能にする |
| EXT-4 | P2 | 抽出失敗時の代替本文がない | — | RSS の `content:encoded` / `description`、HN・Reddit の本文を代替に使う |
| EXT-5 | P2 | Firecrawl 対応はあるが、ワークフローが `FIRECRAWL_API_KEY` を渡していないため CI では使われない | `daily_summary.yml:57-78` | CI-2 と併せて対応する |

### 4.3 フィルタリング・スコアリング

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| SCO-1 | P1 | **精度**: 本文全体（Jina が抽出したナビゲーションやフッターを含む）とキーワードを照合する。そのため `policy`（Privacy Policy など）や `security` で、一般ニュースが地政学として通過する（閾値 3） | §1.3、`scorer.ts:241-268`、`config.yml` の geopolitics | 照合範囲をタイトル＋説明文＋本文冒頭に限り、定型文を除去する |
| SCO-2 | P1 | **再現率**: `\bLLM\b` のような単語境界一致のため `LLMs` に一致しない。また AI 系 2 目的だけにタイトル事前選別があり、タイトルにキーワードがない重要記事を本文取得前に捨てている | `scorer.ts:199-213, 440-448` | 語形変化と正規表現キーワードに対応する。事前選別は Phase 2 の LLM トリアージで置き換える |
| SCO-3 | P2 | 閾値が 8 未満の目的は事前選別をスキップする、という暗黙のルールがある | `scorer.ts:445` | config で `prescreen: true/false` を明示する |
| SCO-4 | P2 | 「TF-IDF」補正がモジュールグローバルの可変状態で、採点順にスコアが依存する（並列処理のため順序は非決定的） | `scorer.ts:38-57, 362, 410` | 全候補で DF を先に計算する 2 パス方式にするか、廃止する |
| SCO-5 | P2 | スコアの尺度が目的間で大きく異なる（09-30: 開発ツール 92.7、地政学 3.1）のに、Reduce へ「最高スコア記事」をトップ候補として渡している | `gemini_reduce.ts:40-71` | 目的内のパーセンタイル等で正規化するか、LLM トリアージの重要度を使う |
| SCO-6 | P2 | `scorer.ts` が `llm_gateway` を import している（AGENTS.md の「scorer.ts では LLM を呼ばない」に反する） | `scorer.ts:11-12, 284-317` | LLM Judge を `filtering/llm_judge.ts` へ分離する |
| SCO-7 | P2 | LLM Judge を有効にすると、抽出フェーズ（並列 3・間隔 200ms）の中で LLM を呼ぶ。`API_CONCURRENCY` / `API_INTERVAL_MS` のレート制御を迂回する（現在は無効のため潜在） | `main.ts:329-332, 353-354` | Map と同じスロットリングで実行するか、バッチ化する |
| SCO-8 | P3 | ドメイン除外が部分一致（`hostname.includes(d)`） | `scorer.ts:136` | 完全一致またはサフィックス一致にする |
| SCO-9 | P3 | URL 正規化で除去するのは `utm_source` / `utm_medium` / `utm_campaign` だけ。BBC の `at_medium` / `at_campaign` やフラグメントが残る（`processed_urls` の 61 件がクエリ付き） | `config.yml` の `exclude`、`scorer.ts:64-74` | `utm_*` を前方一致で除去し、既知のパラメータを追加し、フラグメントを除く |
| SCO-10 | P3 | キーワード拡張の提案が実用にならない（09-30 の提案は "stabbing" と "day"）。トレンド分析は既存キーワードの集計で、ログに出すだけ | `keyword_expansion.ts`、`trend_analyzer.ts`、ログ | 期間集計や背景コーパスとの比較で改善するか、削除する |

### 4.4 要約・LLM ゲートウェイ

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| LLM-1 | P0 | F-01・F-02 | — | Phase 0 |
| LLM-2 | P1 | `@google/generative-ai` は Deprecated（2025-08-31 にサポート終了） | `node_modules/@google/generative-ai/README.md` | `@google/genai` へ移行する |
| LLM-3 | P1 | Gemini の呼び出しにタイムアウトがない（SDK の `RequestOptions.timeout` を指定していない）。Webhook を送る axios 呼び出しにもタイムアウトがない | `llm_gateway.ts:170`、`discord_notifier.ts:58`、`slack_notifier.ts:32`、`teams_notifier.ts:31` | 明示的なタイムアウトを設定する |
| LLM-4 | P1 | サーキットブレーカーがプラットフォーム単位のため、過負荷の 1 モデル（503 が頻発する flash など）が原因で、同じプラットフォームの健全なモデル（flash-lite）まで遮断される | `llm_gateway.ts:398, 427` | `platform/model` 単位にする |
| LLM-5 | P1 | Anthropic の `anthropic-version: "2024-10-22"` は無効な値（有効値は `2023-06-01`）。フォールバック先に設定すると 400 で即失敗する。`responseSchema` も Anthropic では無視される | `llm_gateway.ts:255-291` | ヘッダーを修正し、tool use 等で構造化出力に対応する |
| LLM-6 | P2 | コスト表を部分一致・先頭一致で引くため、`gpt-4.1-mini` が `gpt-4.1` の単価で計算される。価格表もコードにハードコードされている | `metrics.ts:55-94` | 最長一致にし、価格表を config 化する |
| LLM-7 | P2 | 「Semantic Cache」は実行内メモリの完全一致キャッシュである。1 回の実行で同じ URL は 1 回しか処理しないため、実質ヒットしない | `gemini_map.ts:14-26, 53-59` | 削除するか、永続キャッシュとして設計し直す |
| LLM-8 | P2 | プロンプトがファイルとコードに二重定義され、ファイルがないと無言でインライン版に切り替わる。`promptHash` は未使用で、出力と使用プロンプトの対応を追えない。月次・週次のプロンプトは日本語固定 | `prompts.ts`、`prompts/manifest.json` | ファイルを唯一の正とし、版とハッシュを metrics・frontmatter に記録し、多言語化する |

### 4.5 品質評価

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| QA-1 | P0 | 品質スコアを公開の判定に使っていない（F-02） | `main.ts:446-460` | ゲート化する |
| QA-2 | P1 | 評価が表層的。Map 成功率、Fallback Mode、期待集合にない URL（捏造リンク）を検出しない。`Actionable Insights` は「技術」「影響」のような一般語があれば常に合格する | `quality_checker.ts:195-234` | Map 成功率・fallback 検出・引用の precision を追加し、閾値を config 化する。任意で LLM による根拠性のサンプリング評価を加える |
| QA-3 | P2 | 目標文字数とチェック数が文書・プロンプト・実装で食い違う。文字数は docs が 2,000〜8,000、実装が 1,200〜8,000、日本語プロンプトが 3,000〜5,000。チェック数は docs が 6、実装が 7 | `docs/architecture.md`、`quality_checker.ts:81-96`、`prompts.ts:213` | 単一の設定値に統一する |

### 4.6 保存・配信

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| PUB-1 | P0 | F-03（Podcast のコマンドインジェクション）、F-04（Pages の XSS） | — | Phase 0 |
| PUB-2 | P1 | Obsidian の前日リンク `[[YYYY-MM-DD_summary]]` が、実ファイル名 `YYYY-MM-DD_digital-trend_daily_summary.md` と一致せず、常にリンク切れになる | `markdown_builder.ts:67, 131`、`main.ts:468` | リンク先を直すか、`aliases` を付ける |
| PUB-3 | P1 | Atom フィードのリンク先が `https://github.com/artifacts/...` という存在しない URL で、フィード自体も Pages に置かれないため購読できない | `feed_generator.ts:27, 69-81` | Pages の URL で `_site/feed.xml` に出力する |
| PUB-4 | P2 | frontmatter の `sources` に目的キーが入る。`top_story` は LLM が選んだトップではなく、キーワードスコアの最大値。`selectedArticles.sort` で配列を破壊的に並べ替えている | `main.ts:493-494, 528` | 出典名を格納し、Reduce の出力からトップを取り出す |
| PUB-5 | P2 | Slack に Markdown をそのまま送っている（`**bold**`・`[text](url)`・`##` は mrkdwn で解釈されない）。2,800 字で機械的に切断する。Discord・Slack の案内文は日本語固定 | `slack_notifier.ts:28-52`、`discord_notifier.ts:25` | mrkdwn に変換し、出力言語に合わせる |
| PUB-6 | P2 | `publish:complete` イベントが、実際に配信したかどうかに関係なく固定のチャネル一覧を通知する | `main.ts:561` | 配信結果を集計して通知する |
| PUB-7 | P2 | 月次レポートの frontmatter `type` が `daily_summary` に固定されている | `markdown_builder.ts:47` | `type` を引数にする |
| PUB-8 | P3 | `pages_generator.ts` は 2,288 行（CSS とクライアント JS をテンプレート文字列で内包）。自作の Markdown パーサーは番号付きリスト等に未対応 | `pages_generator.ts:969-2288` | 静的アセットに分離し、ライブラリを使う |
| PUB-9 | P3 | Podcast の台本は日本語見出しの正規表現に依存しており、`en` 出力では冒頭と締めの挨拶だけになる | `podcast_generator.ts:54` | 言語別テンプレートにするか、既定で無効にする |

### 4.7 状態管理・冪等性

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| ST-1 | P1 | `config.yml` の `state_ttl_days` が使われず、90 日にハードコードされている | `state_manager.ts:20, 41, 112, 171` | config から注入する |
| ST-2 | P1 | 選ばれなかった記事は処理済みにならないため、RSS に残っている同じ記事を毎日 Jina で取り直している（抽出時間が長い主因の一つ） | `main.ts:563-566` | 「評価済み（不採用）」を短い TTL で記録する |
| ST-3 | P2 | 失敗した実行や 0 件の実行では `pipeline_runs`・メトリクスが保存されない（早期 return、致命的エラー時は `cleanup` のみ） | `main.ts:268-271, 365-368, 706-717` | 実行ステータス付きで常に保存する |
| ST-4 | P2 | スキーマのマイグレーション機構がない（`CREATE TABLE IF NOT EXISTS` のみ） | `state_manager.ts:34-80` | `PRAGMA user_version` で段階的に移行する |
| ST-5 | P2 | 版日付が UTC の実行日になっている。定期実行は 2〜4.5 時間遅れており、0 時 UTC を跨ぐと日付がずれ、前日分の上書きや欠番が起き得る | `main.ts:95`、§1.1 | 版日付を JST で明示的に決め、既存ファイルの上書きを防ぐ |

### 4.8 CI/CD・ワークフロー

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| CI-1 | P1 | PR 用の CI がない。テスト・Lint・ビルドは手元任せで、Dependabot PR も無検証 | `.github/workflows/` | `ci.yml` を追加する |
| CI-2 | P1 | `daily_summary.yml` が `OPENAI_API_KEY`・`ANTHROPIC_API_KEY`・`LANGFUSE_*`・`YOUTUBE_API_KEY`・`FIRECRAWL_API_KEY` を渡していない。docs は「同名で Secret 登録すれば有効」と案内しているが、マルチ LLM フォールバック・Langfuse・YouTube は CI では動かない | `daily_summary.yml:57-78`、`docs/configuration.md` | 環境変数を追加する |
| CI-3 | P1 | `workflow_dispatch` の `dry_run` 入力がどこにも配線されていない。`true` にしても LLM 呼び出しと Discord 配信が実行される | `daily_summary.yml:9-13` | `DRY_RUN` を実装し、配信・`markAsProcessed`・コミットをスキップする |
| CI-4 | P1 | `git push \|\| true` や `\|\| echo` で push の失敗を無視している。artifacts への push が失敗しても状態 DB だけは本体に push され、成果物を失ったまま URL が処理済みになる。artifacts の checkout は `continue-on-error` のため、失敗すると当日分だけの Pages で上書きされる | `daily_summary.yml:36-42, 96-119` | 失敗はジョブの失敗にする。状態と成果物を同じコミットにする（Phase 4） |
| CI-5 | P1 | `on_demand.yml` は artifacts を checkout せず、存在しない `content/` を `git add` する。生成物は失われ、状態 DB だけがコミットされる | `on_demand.yml:63` | daily と同じ処理系に統合する（reusable workflow） |
| CI-6 | P2 | cron が毎時 0 分（GitHub は高負荷時に遅延・ドロップがある）。実測で 2〜4.5 時間遅延している | `daily_summary.yml:6` | 0 分を避ける（例: `23 18 * * *`） |
| CI-7 | P2 | 月次の `30 19 1 * *` は UTC の 1 日なので、**JST では 2 日の 04:30** に実行される（コメントと AGENTS.md は「JST 1 日」）。生成に失敗しても `null` を返して「No daily summaries found」と誤表示し、exit 0 で終わる | `monthly_digest.yml:4-6, 54-71`、`monthly_digest.ts:126-129` | 記述を直すか、日次実行で月末を判定する。失敗時は exit 1 にする |
| CI-8 | P2 | `concurrency` が `pages.yml` にしかなく、手動実行と定期実行が状態 DB・artifacts・Pages デプロイで競合し得る | 各ワークフロー | 例として `concurrency: daily-pipeline` を設定する |
| CI-9 | P2 | 月次・年次・on-demand で環境変数や `ARTIFACTS_REPO` の扱いがばらばら（ハードコードと `vars`）。年次はプレースホルダー | 各ワークフロー | reusable workflow / composite action に統一する |
| CI-10 | P3 | 週次ダイジェストは実装・テスト済みだが、起動するワークフローも CLI もない | `src/aggregation/weekly_digest.ts` | ワークフローを追加するか、削除する |

### 4.9 セキュリティ

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| SEC-1 | P0 | F-03（コマンドインジェクション） | — | Phase 0 |
| SEC-2 | P0 | F-04（XSS） | — | Phase 0 |
| SEC-3 | P1 | docs は `PAT_GITHUB` に `repo` スコープを案内している（classic PAT なら全リポジトリへの書き込み権限）。checkout（`persist-credentials: true`）でジョブ中の git 資格情報として保持され、その後の `npm ci`（install script を持つパッケージを含む）や LLM 出力を扱う処理と同じジョブに残る | `daily_summary.yml:30-42`、`docs/configuration.md` | artifacts 用は GitHub App トークンか、対象リポジトリ限定の fine-grained PAT にする。本体への push は `GITHUB_TOKEN`（`contents: write`）で足りる。`persist-credentials: false` にする |
| SEC-4 | P2 | `${{ secrets.PAT_GITHUB }}` をシェルスクリプトに直接展開している | `daily_summary.yml:98, 103` | `env:` 経由で参照する |
| SEC-5 | P2 | Action のピン留めが不統一（SHA 8 箇所、タグ 10 箇所） | 各ワークフロー | すべて SHA でピン留めし、Dependabot で更新する |
| SEC-6 | P2 | ワークフロー全体に `pages: write` / `id-token: write` を付与している | `daily_summary.yml:18-21` | ジョブ単位の最小権限にする |
| SEC-7 | P2 | `npm audit` で high 1 件（`brace-expansion`） | — | `npm audit fix` を実行し、CI で `--audit-level=high` を検査する |
| SEC-8 | P3 | メール送信のログに宛先アドレスを出力している | `email_notifier.ts:168` | マスクする |

### 4.10 テスト・コード品質

| ID | 重要度 | 指摘 | 根拠 | 対応案 |
| :-- | :-- | :-- | :-- | :-- |
| QL-1 | P1 | `tests/concurrency.test.ts` が `src/main.ts` を import するため、import 時に `main()` が実行される。検証時も実際に Hacker News へのリクエストが発生し、Jest がワーカーを強制終了した。`.env` があれば、ローカルの `pipeline_state.db` への書き込み・LLM 課金・Discord 投稿が起こり得る。`--forceExit` がこれを隠している | `main.ts:706-717`、`tests/concurrency.test.ts:5`、`package.json` | エントリーポイントを分離する |
| QL-2 | P1 | ESLint が TypeScript を 1 ファイルも検査していない（docs には「TypeScript, JSON, YAML を Lint」とある） | `eslint.config.mjs` | typescript-eslint を導入する |
| QL-3 | P1 | 重要経路のテストがない（22 ファイル・2,985 行がどのテストからも読み込まれない） | §1.4 | Phase 3 の 3-4 |
| QL-4 | P2 | 「ゴールデン回帰テスト」は、モックした設定の上でのスコアラー単体テストにすぎず、実際の `config.yml` も要約の品質も検証していない | `tests/golden_regression.test.ts:14-60` | 実 config と本番由来のデータで構成し直す |
| QL-5 | P2 | 未使用のコード・依存が多い（下表） | 静的解析 | `noUnusedLocals` を有効にし、削除するか配線する |
| QL-6 | P2 | `main.ts` の `main()` が約 530 行あり、9 種のソースでほぼ同一のブロックが並ぶ | `main.ts:94-621` | ステージに分割し、アダプターのレジストリで解決する |
| QL-7 | P3 | Zod 4 の `ZodError` には `.errors` がないため、設定エラー表示の分岐が死んでいる。dotenv 17 は読み込みのたびに宣伝ログを出す | `config.ts:22, 39-41`、ログ | `z.prettifyError` と `dotenv.config({ quiet: true })` を使う |
| QL-8 | P3 | `.vscode` は Prettier を既定のフォーマッタに指定しているが、依存も設定もない | `.vscode/settings.json` | Prettier か Biome を導入し、`format:check` を追加する |
| QL-9 | P3 | `.gitignore` で `pipeline_state.db` を無視しながら追跡している（ワークフローは `git add -f`）。`_*` で先頭が `_` のファイルをすべて無視している | `.gitignore` | Phase 4 の状態移設で解消する。`_*` は限定的なパターンにする |

QL-5 の内訳（`src/` 内から参照されていないもの）:

| 種別 | 対象 |
| :-- | :-- |
| 未使用の依存 | `p-retry`、`uuid`（コードからの import なし。jest の `transformIgnorePatterns` にのみ登場） |
| 未配線の機能 | プラグインレジストリ（登録 0 件・ハンドラ 0 件）、`recordGeneration`（Langfuse スパン）、`createZennDraft` / `publishToNote`（`NOTE_API_TOKEN` も未使用）、`generateWeeklyDigest`（テストのみ） |
| 未使用の関数・定数 | `clearState` / `getProcessedCount` / `getRecentRuns`、`generateRelatedLinks` / `generateObsidianFooter`、`promptHash`、`MAP_SYSTEM_PROMPT` / `REDUCE_SYSTEM_PROMPT`、`clearFactCache` |
| 未使用の import | `main.ts` の `formatSuggestionReport` / `formatTrendAnalysis`、`trend_analyzer.ts` の `llmCall` |

### 4.11 ドキュメントの不整合

| 記述 | 実際 |
| :-- | :-- |
| README / AGENTS.md「7 種類のソース」 | 9 種類（Reddit・Bluesky を含む）。`docs/sources.md` は 9 種 |
| 「Quality Gate」（README・`docs/architecture.md`） | 評価のみで、ゲートは未実装 |
| 「Reduce = Gemini Pro」 | `config.yml` は `latest-flash` |
| 「11 スイート / 75+ テスト」 | 22 スイート / 134 件 |
| 「Jina Reader に p-retry」 | 自前の `core/retry.ts`（`p-retry` は未使用の依存） |
| 「Plugin Registry で core を変更せずに追加できる」 | 組み込みのソース・配信先は `main.ts` に直書きで、レジストリは使われていない |
| 「Langfuse にトレース・スパン・品質スコアを送信」 | スパン（`recordGeneration`）は呼ばれていない |
| 「連続 3 日以上 0 件のソースは自動アラート」 | 判定ロジックの不一致で発火しない（F-05） |
| 「デフォルトの `GITHUB_TOKEN` では git push できない」 | 同じリポジトリへは `contents: write` で push できる（PAT が必要なのは他リポジトリへの push） |
| 月次「毎月 1 日 04:30 JST」 | JST では毎月 2 日 04:30 |
| AGENTS.md のミッション「note.com へ出力」 | 未実装（`publishToNote` はログを出すだけ） |
| `debug:filter` の出力例 | 実装の出力形式と異なり、実パイプラインの判定（事前選別・閾値）も再現しない |
| `.agents/skills/SKILL.md`、`.agents/rules/coding-standards.md` | `processed_urls.json`（現在は SQLite）、3 ソースのみ、p-retry など古い記述 |
| `src/main.ts` 冒頭「36 項目を実装」、各所の `Item X.Y` | 参照先の計画書がリポジトリにない |

---

## 5. 改善ロードマップ

### Phase 0: 劣化配信の停止（即日〜2 日、P0）

- [ ] 0-1 リポジトリ変数 `AI_MODEL_MAP=gemini-3.5-flash-lite` を設定する（コード変更不要。09-22 まで正常に動作していたモデル）
- [ ] 0-2 9 月の月次ダイジェスト（10-01 19:30 UTC に定期実行）は劣化日を含む。修正後に `workflow_dispatch` で再生成するか、劣化期間の注記を付ける
- [x] 0-3 `model_resolver` を、`supportedGenerationMethods` に `generateContent` を含むモデルに限定し、`-tts`・`-image`・`-audio`・`-live`・`embedding` 系を除外するよう直す。派生モデルが混在するテストを追加する
- [x] 0-4 ゲートウェイで 4xx も `metrics.errors` に記録する。モデル非互換系の 400 は次の候補へフォールバックする
- [x] 0-5 Map 失敗時のプレースホルダーを廃止し、成功した記事だけを Reduce に渡す。`map_success_rate` を算出する
- [x] 0-6 実行ステータス `degraded` を導入する。Map 成功率が閾値（初期値 50%）未満、Reduce が fallback、または品質スコアが閾値（初期値 60）未満の場合は次のようにする
  - 外部配信（Discord・Slack・Teams・Email）を止める
  - `markAsProcessed` をしない（翌日に再試行できる）
  - 非 0 で終了してジョブを失敗させる
- [x] 0-7 Podcast を `execFileSync`（シェルを経由しない）に変える
- [x] 0-8 `markdownToHtml` の生 HTML 素通しをやめ（固定行の完全一致のみ許可）、CSP を付ける

> **進捗（2026-10-01）**: 0-3〜0-8 を実装した。実装時に決めた点は次のとおり。
>
> - 0-6 の Map 成功率の初期値は 80% から 50% に変えた。失敗した記事は Reduce に渡らず（タイトルだけの要約は起きない）、翌日に再試行されるため、ゲートは全体的な障害の検出に絞った。値は `config.yml` の `settings.quality_gate` で変更できる
> - 0-4 では、Map でも Reduce と同様に同一プラットフォーム上のもう一方のモデルへフォールバックするようにした。また、クライアントエラーはサーキットブレーカーに数えないようにした
> - degraded の実行でも状態 DB とメトリクスはコミットされる（ワークフローがステップ出力 `run_status` を参照する）
> - 0-1・0-2 はリポジトリ設定とワークフローの手動実行が必要なため、未完了のまま残す

**完了条件**: 劣化条件（TTS モデルの混入、Map の全失敗、Reduce の失敗）を再現するテストで、「配信されない」「処理済みにならない」「終了コードが 0 以外」を確認できること。

### Phase 1: 信頼性と正しさ（〜2 週、P1）

- [ ] 1-1 ソースの結果型 `SourceResult` と健全性の記録（`disabled` を追加）。連続失敗判定を修正し、Job Summary と Discord に障害を通知する
- [ ] 1-2 死んでいる 8 ソースを修正・差し替え・明示的に無効化する。`npm run check:sources`（到達性チェック）を週次ワークフローに入れる
- [ ] 1-3 URL 正規化を一元化（`core/url.ts`）し、`isProcessed` を正規化後の URL で照会する。本文取得前に重複を除く
- [ ] 1-4 Jina の再試行対象を限定し、ドメイン単位のブレーカー、`JINA_API_KEY`、失敗理由の計測、RSS 本文などへのフォールバックを入れる
- [ ] 1-5 Raindrop は採用した項目だけをアーカイブする
- [ ] 1-6 X/Grok は、検索ツール付きで実装し直すまで無効化する（設定で明示）
- [ ] 1-7 ワークフローを修正する
  - 環境変数の受け渡しを追加する
  - `dry_run` を実装する
  - `concurrency` を設定する
  - cron の分をずらす
  - push の失敗を検知する
  - on_demand の出力先を直す
  - 月次の失敗検知とコメントを直す
- [ ] 1-8 版日付を JST で決め、既存ファイルの上書きを防ぐ
- [ ] 1-9 出力の整合性を直す（Obsidian の前日リンク、Atom フィード、frontmatter の `sources` / `top_story`、`state_ttl_days`、コスト表の最長一致、Anthropic のバージョンヘッダー、Webhook・LLM のタイムアウト）

**完了条件**: 稼働ソース率が 90% 以上（無効化は明示）、抽出フェーズが 4 分以下、ソース障害が 2 日以内に通知されること。

### Phase 2: 選定・要約の品質（〜4 週、P1〜P2）

- [ ] 2-1 **バッチ LLM トリアージ**を導入する。取得直後にタイトル・説明文・ソース情報をまとめて Flash-Lite に 1〜2 回投げ、関連度・目的・重要度を構造化出力で受け取る
  - キーワードによる事前選別をこれで置き換え、Jina での本文取得は上位候補に限る
  - 入力は 1 日あたり 1〜2 万トークン程度で、現行の単価なら 1 日 1 セント未満の見込み
- [ ] 2-2 キーワードスコアの照合範囲（タイトル＋説明文＋本文冒頭）、語形変化・正規表現への対応、`prescreen` の明示的な設定
- [ ] 2-3 IDF 補正を決定的にするか削除し、目的間でスコアを正規化する
- [ ] 2-4 品質評価を拡張する（引用の precision、Map 成功率、fallback 検出、閾値の config 化。任意で LLM による根拠性のサンプリング評価）
- [ ] 2-5 プロンプトを単一ソースにし、版とハッシュを記録し、月次・週次を多言語化する
- [ ] 2-6 本番ログ由来の回帰データセット（§1.3 の取りこぼし例・誤検出例）を、実際の `config.yml` で検証するテストを作る

**完了条件**: 回帰データセットで、関連記事の再現率が 90% 以上、対象外記事の通過率が 10% 以下、引用の precision が 100% であること。

### Phase 3: エンジニアリング基盤（Phase 1・2 と並行、〜3 週）

- [ ] 3-1 `ci.yml`（pull_request / push）を追加する。`npm ci` → type-check → lint → test → build の順に実行し、actionlint と `npm audit --audit-level=high` も行う
- [ ] 3-2 typescript-eslint（`no-floating-promises`、`no-unused-vars` など）を導入する。tsconfig の `noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` / `noFallthroughCasesInSwitch` を有効にし、フォーマッタも導入する
- [ ] 3-3 エントリーポイントを分離する（`src/cli/daily.ts`）。`mapWithConcurrency` を `core/` へ移し、`--forceExit` をやめる
- [ ] 3-4 テストを拡充する
  - `state_manager`（`:memory:` の DB を使う）
  - 各アダプター（HTTP フィクスチャを使う）
  - ゲートウェイのエラー分類とフォールバック
  - Map / Reduce
  - パイプラインの統合テスト（外部依存はすべてモック）
- [ ] 3-5 `@google/genai` へ移行する。あわせてサーキットをモデル単位にし、Anthropic の構造化出力に対応し、未使用の依存（`p-retry`、`uuid`）を削除する。`npm audit fix`、`dotenv` の `quiet`、Zod 4 のエラー表示も対応する
- [ ] 3-6 権限と資格情報を見直す
  - GitHub App トークンか、対象を限定した fine-grained PAT にする
  - `persist-credentials: false` にする
  - ジョブ単位の permissions にする
  - すべての Action を SHA でピン留めする
  - Secret をスクリプトに直接展開しない

**完了条件**: PR で CI が必須になり、すべての TS ファイルが Lint 対象になり、重要モジュール（main、状態管理、ゲートウェイ、Map / Reduce、取得）の行カバレッジが 70% 以上であること。

### Phase 4: アーキテクチャと保守性（1〜2 ヶ月、P2〜P3）

- [ ] 4-1 状態 DB を artifacts リポジトリへ移し、成果物と状態を 1 コミットで保存する。本体 `main` への日次 bot コミットをなくし、ブランチ保護を有効にする
- [ ] 4-2 `main.ts` をステージ関数（取得 → 抽出 → 選定 → Map → Reduce → 評価 → 配信 → 永続化）に分割し、依存を注入する。ソースと配信先はレジストリで解決する（プラグインレジストリを実際に使うか、削除する）
- [ ] 4-3 実行ステータス（success / degraded / failed / skipped）を、`pipeline_runs`・metrics・Job Summary に必ず記録する
- [ ] 4-4 `pages_generator.ts` を分割（CSS・JS を静的アセットへ）し、HTML を無効化した Markdown レンダラーと CSP を使う
- [ ] 4-5 未配線の機能について、配線するか削除するかを決める（週次はワークフロー追加、年次は月次からの集約か削除、note.com / Zenn、キーワード拡張・トレンド分析、Langfuse スパン、Podcast）
- [ ] 4-6 ドキュメントの不整合（§4.11）を直し、ADR（Architecture Decision Record）を導入し、`Item X.Y` コメントを整理する

---

## 6. KPI

| 指標 | 現状 | 目標 | 計測方法 |
| :-- | :-- | :-- | :-- |
| Map 成功率 | 直近 8 回は 0%（09-10〜09-22 は 100%） | 95% 以上 | metrics の `map_success_rate` |
| 劣化サマリーの外部配信 | 25 回中 10 回 | 0 回 | 実行ステータス |
| 稼働ソース率 | 7/15（47%） | 90% 以上（無効化は明示） | `source_health` |
| ソース障害の検知時間 | 23 日間未検知 | 2 日以内 | アラート |
| Jina の抽出成功率 | 65/101（64%） | 90% 以上 | 抽出メトリクス |
| 実行時間 | 13 分 48 秒（うち抽出 11 分） | 6 分以下 | metrics |
| 配信時刻（予定は 04:00 JST） | 06:08〜08:36 JST に開始 | 予定から 30 分以内 | Actions |
| 対象外記事の通過 | 09-30 の地政学で 26 件中 10 件以上 | 回帰データで 10% 以下 | 回帰テスト |
| どのテストからも読み込まれないソース | 22 ファイル・2,985 行 | CLI を除き 0 | カバレッジ |
| Lint 対象の TS ファイル | 0 | 全ファイル | CI |
| high 以上の脆弱性 | 1 件 | 0 件 | `npm audit` |

---

## 7. 設計方針の提案

### 7.1 エラー処理: 失敗を値として運ぶ

- アダプター・本文抽出・LLM 呼び出しでは、例外を握りつぶして空値やプレースホルダーに変換しない。`{ ok: true, value }` または `{ ok: false, kind, error }` のような結果型で返し、劣化かどうかは呼び出し側が判断する
- 「`console.error` だけで終わる `catch`」を禁止し、必ず metrics に記録するルールを AGENTS.md に加える

### 7.2 実行ステータスと公開ゲート

| ステータス | 条件の例 | 振る舞い |
| :-- | :-- | :-- |
| `success` | ゲートをすべて満たす | 公開・処理済み化・コミット |
| `degraded` | Map 成功率が閾値未満、Reduce が fallback、引用 precision が不一致 | 成果物はドラフトとして保存し、外部配信はしない。処理済みにせず、ジョブを失敗させて通知する |
| `failed` | 致命的エラー | 何も公開せず、状態を進めない。実行記録だけ残す |
| `skipped` | 新着 0 件など | 実行記録だけ残す |

### 7.3 モデル選択

- 本番は明示的なモデル ID を config で固定し、変更は PR 経由にする。CI で `models.list` を引き、存在と `generateContent` 対応を検証する
- 自動解決を残す場合は、能力ベース（`supportedGenerationMethods`、派生モデルの除外）で選び、選んだ結果を Job Summary に表示する。Google が提供する `-latest` 系エイリアスが使えるなら、それも検討する

### 7.4 状態と成果物の原子性

- 現在は「artifacts リポジトリへの成果物 push」と「本体リポジトリへの状態 DB push」が独立しており、片方だけ成功し得る
- artifacts リポジトリに `state/pipeline_state.db` を置き、1 コミットで push する。これでワークフローは本体リポジトリへの書き込み権限が不要になる

### 7.5 関連性判定の二段構え

1. 低コストなバッチ LLM トリアージ（タイトル・説明文）で候補を 20〜30 件に絞る
2. 本文を取得して Map にかける。キーワードスコアは説明可能性のための補助特徴量として残す

### 7.6 コスト配分の見直し

- 実績のコストは約 $0.01/日で、コスト削減の余地は小さい。品質（トリアージ、根拠性評価）と堅牢性への投資の方が効果が大きい
- Free Tier 前提の「間隔 13 秒・並列 1」は、有料枠にすれば所要時間を大きく短縮でき、無料枠に固有のクォータ失敗（09-23 の 429 など）も避けられる

---

## 8. PR 分割案

推奨する順序で並べる。各 PR では「失敗を再現するテストを先に追加し、その後で修正する」順に進める。

| # | 内容 | 対応 ID | 規模 |
| :-- | :-- | :-- | :-- |
| 1 | モデル解決の修正、4xx の記録、Map プレースホルダーの廃止、`degraded` ゲート、テスト | F-01、F-02、QA-1 | 中 |
| 2 | Podcast のシェル非経由化、Pages の生 HTML 撤廃、CSP、テスト | F-03、F-04 | 小 |
| 3 | `ci.yml`、typescript-eslint、エントリーポイントの分離 | CI-1、QL-1、QL-2 | 中 |
| 4 | `SourceResult`、健全性の記録、アラート | F-05、ING-1 | 中 |
| 5 | URL 正規化、arXiv の修正、Jina の再試行方針、Raindrop のアーカイブ | ING-2、ING-3、EXT-1〜4 | 中 |
| 6 | ワークフローの修正一式 | CI-2〜CI-9、ST-5 | 中 |
| 7 | 死んでいるソースの差し替え（config が中心） | ING-5、ING-6 | 小 |
| 8 | 出力の整合（Obsidian、Atom、frontmatter、TTL、コスト表、タイムアウト、Anthropic） | PUB-2〜PUB-7、ST-1、LLM-3、LLM-5、LLM-6 | 中 |
| 9 | バッチ LLM トリアージ、スコアの改善、回帰データセット | SCO-1〜SCO-7、QA-2 | 大 |
| 10 | `@google/genai` への移行、モデル単位のサーキット | LLM-2、LLM-4 | 中 |
| 11 | 状態 DB の artifacts への移設、権限の見直し | SEC-3〜SEC-6、CI-4、QL-9 | 中 |
| 12 以降 | `main.ts` の分割、Pages の分割、未配線機能の整理、ドキュメントの整合 | QL-5、QL-6、PUB-8、§4.11 | 大 |

---

## 付録 A: 調査方法と根拠

- **静的レビュー**: `src/` の全 45 ファイル、`tests/`、ワークフロー、設定、プロンプト、ドキュメントを通読した
- **実行検証**（作業ツリーを汚さないよう隔離コピー上で実施）: `tsc --noEmit`、`eslint .`、`npm run test:config`、`jest`（カバレッジ付き）、`npm audit`、`npm outdated`
- **実運用データ**: 同梱 `pipeline_state.db` の読み取り専用コピーを集計した（`pipeline_runs.metrics_json` の `llm_calls` / `errors`、`source_health`、`processed_urls`）
- **実行ログ**: Daily Trend Summary run #28（2026-09-30 22:45 UTC 開始）のジョブログ

主なログの抜粋（09-30）:

```text
🤖 Auto-resolved latest-flash-lite on google to -> gemini-3.8-flash-lite-tts
⚠️ Map extraction failed for https://github.com/aws/agent-toolkit-for-aws: [GoogleGenerativeAI Error]: ... [400 Bad Request] Developer instruction is not enabled for this model
  → Extracted facts from 10 articles.
📝 Phase 4: Reduce Summarization...
🤖 Auto-resolved latest-flash on google to -> gemini-3.8-flash
  📊 Quality Score: 100.0/100
✅ Discord notification sent successfully.
```

```text
⚠️ Failed to fetch RSS feed [Reuters Technology]: getaddrinfo ENOTFOUND feeds.reuters.com
⚠️ Failed to fetch RSS feed [VentureBeat]: Status code 429
⚠️ Failed to fetch RSS feed [Hugging Face Daily Papers]: Status code 401
⚠️ Failed to fetch RSS feed [Ledge.ai (LEDGE)]: Status code 404
⚠️ Reddit fetch failed for r/LocalLLaMA: Request failed with status code 403
⚠️ Bluesky fetch failed for query "AI OR LLM": Request failed with status code 403
```

## 付録 B: 前提・未確認事項

- 09-23〜09-30 の要約本文（artifacts リポジトリ）は本レビューでは参照していない。劣化の判定は、実行ログとメトリクス（Map 呼び出しが 0 件）に基づく
- 外部 API の仕様（arXiv の `<id>` 形式、xAI の検索ツール、Reddit・Bluesky の認証要件、Gemini の `-latest` エイリアス）は、実装時に最新の公式ドキュメントで再確認すること
- 稼働ソース率などの数値は、2026-09-07〜09-30 の 23 日分のデータに基づく
- 「対象外記事」の判定は、09-30 の実行ログにあるタイトルに対するレビュー者の判断である
