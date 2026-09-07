---
name: Pipeline Overview
description: Understand the full pipeline architecture and data flow
---

# Obsidian HeadQuarter Pipeline Skill

## Pipeline Phases

### Phase 1: Ingestion
- **Modules**: `rss.ts`, `raindrop.ts`, `xai_grok.ts`
- **Purpose**: Fetch new article URLs from configured sources
- **Key**: Each module checks `state_manager.ts` to skip already-processed URLs
- **Output**: `ArticleItem[]` — array of {sourceName, sourceType, title, url, publishedAt}

### Phase 2: Extraction & Filtering
- **Modules**: `jina_reader.ts` → `scorer.ts`
- **Purpose**: Extract clean Markdown from each URL, then apply exclusion rules and scoring
- **Key**: Jina Reader returns clean content; scorer applies domain/keyword/length filters and TF-IDF-style scoring
- **Output**: `ArticleData[]` filtered and scored above `daily_threshold_score`

### Phase 3: Map (Gemini Flash)
- **Module**: `gemini_map.ts`
- **Purpose**: Extract concise facts (< 150 chars each) + citation URLs from each article
- **Key**: Uses `Promise.allSettled` — individual failures don't crash the pipeline
- **Output**: `MapOutput[]` — JSON array of {facts[], sourceUrl, sourceTitle}

### Phase 4: Reduce (Gemini Pro)
- **Module**: `gemini_reduce.ts`
- **Purpose**: Synthesize all facts into a single TOP 1+3 Japanese summary
- **Key**: Has fallback mechanism; includes citation links in output
- **Output**: Markdown string in strict TOP 1+3 format

### Phase 5: Storage & Publishing
- **Modules**: `markdown_builder.ts`, `discord_notifier.ts`, `note_api.ts`
- **Purpose**: Save to filesystem, notify Discord, publish to note.com
- **Key**: Also marks processed URLs in state DB and archives Raindrop items

## Configuration Files
- `config.yml` — Sources, exclusion rules, scoring categories
- `.env` — API keys and tokens (never committed)
- `processed_urls.json` — Deduplication state (auto-generated)
