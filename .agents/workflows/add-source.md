---
description: How to add a new information source to the pipeline
---

## Adding an RSS Source

1. Add entry to `config.yml` under `sources:`:
```yaml
sources:
  - type: rss
    name: "Human-readable Name"
    url: "https://example.com/feed.xml"
```

2. No code changes required — the pipeline automatically picks up new RSS sources.

## Adding a New Source Type (e.g., API)

1. Create a new module in `src/ingestion/` (e.g., `new_source.ts`)
2. Export a function that returns `ArticleItem[]` (defined in `src/ingestion/rss.ts`)
3. Add the new type to `SourceSchema` in `src/core/types.ts`
4. Wire it into `src/main.ts` Phase 1 using `Promise.allSettled`
5. Update `AGENTS.md` with the new source type

## ArticleItem Interface

Every ingestion module must return items matching:
```typescript
interface ArticleItem {
  sourceName: string;    // Human-readable source name
  sourceType: string;    // "rss" | "raindrop" | "xai_grok" | etc.
  title: string;
  url: string;
  publishedAt: string;   // ISO 8601
}
```
