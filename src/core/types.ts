import { z } from "zod";

// --- Purpose-Specific Scoring ---
export const PurposeKeywordSchema = z.object({
  word: z.string(),
  weight: z.number(),
});

export const PurposeScoringSchema = z.object({
  threshold: z.number().default(0),
  title_multiplier: z.number().default(1.0),
  keywords: z.array(PurposeKeywordSchema).default([]),
});

export type PurposeScoring = z.infer<typeof PurposeScoringSchema>;

// --- Source Definitions ---
// Each source variant configures how data is fetched.
// Item 2.3: Added new source types (hackernews, arxiv, youtube, github_trending)
// Item 2.6: Added optional language field for multi-language ingestion
export const SourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rss"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    url: z.string().url(),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("xai_grok"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    query: z.string(),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("raindrop"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    collection_id: z.number().default(0),
    archive_collection_id: z.number().optional(),
    lookback_hours: z.number().default(48),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("hackernews"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    min_score: z.number().default(100),
    max_items: z.number().default(30),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("arxiv"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    query: z.string(),
    max_results: z.number().default(20),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("youtube"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    channel_id: z.string().optional(),
    query: z.string().optional(),
    max_results: z.number().default(10),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("github_trending"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    language_filter: z.string().optional(), // programming language
    since: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  }),
  z.object({
    type: z.literal("reddit"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    subreddit: z.string(),
    min_score: z.number().default(50),
    max_items: z.number().default(15),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("bluesky"),
    name: z.string(),
    enabled: z.boolean().default(true), // false skips the source and records it as "disabled"
    query: z.string(),
    min_likes: z.number().default(20),
    max_items: z.number().default(15),
    language: z.string().optional(),
  }),
]);

export type Source = z.infer<typeof SourceSchema>;

// --- Purpose Definition ---
export const QuotaSchema = z.object({
  min: z.number().default(0),
  max: z.number().default(10),
});

// A Purpose acts as a domain collection of sources and scoring rules.
export const PurposeSchema = z.object({
  label: z.string(),
  priority: z.number().default(5),
  quota: QuotaSchema.default({ min: 0, max: 10 }),
  scoring: PurposeScoringSchema.nullable().default(null), // null = curated (dynamic assignment)
  sources: z.array(SourceSchema).default([]),
});

export type Purpose = z.infer<typeof PurposeSchema>;

// --- Exclude Rules ---
// Item 3.4: Enhanced with scope and regex support for negative keywords
export const ExcludeKeywordSchema = z.union([
  z.string(), // Legacy: plain string → checked everywhere
  z.object({
    pattern: z.string(),
    scope: z.enum(["title", "content", "both"]).default("both"),
    is_regex: z.boolean().default(false),
  }),
]);

export type ExcludeKeyword = z.infer<typeof ExcludeKeywordSchema>;

export const ExcludeSchema = z.object({
  domains: z.array(z.string()).default([]),
  url_strip_parameters: z.array(z.string()).default([]),
  keywords: z.array(ExcludeKeywordSchema).default([]),
  content_length: z
    .object({
      min: z.number().default(0),
      max: z.number().default(Number.MAX_SAFE_INTEGER),
    })
    .default({ min: 0, max: Number.MAX_SAFE_INTEGER }),
});

export type ExcludeRules = z.infer<typeof ExcludeSchema>;

// --- Model Configuration ---
// Item 1.2: Multi-LLM fallback support
// Item 1.4: Thinking model support
export const ModelProviderSchema = z.object({
  platform: z.string().default("google"),
  map: z.string().default("gemini-2.0-flash"),
  reduce: z.string().default("gemini-2.0-pro"),
  thinking: z.boolean().default(false),
});

export const FallbackModelSchema = z
  .object({
    platform: z.string(),
    map: z.string(),
    reduce: z.string(),
  })
  .optional();

// --- Publishing ---
export const ReportKindSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
const ALL_REPORT_KINDS: ("daily" | "weekly" | "monthly" | "yearly")[] = ["daily", "weekly", "monthly", "yearly"];
const PERIODIC_REPORT_KINDS: ("daily" | "weekly" | "monthly" | "yearly")[] = ["weekly", "monthly", "yearly"];

export const PublishingSchema = z.object({
  // Report kinds sent to Discord / Slack / Teams / email
  notify_kinds: z.array(ReportKindSchema).default(ALL_REPORT_KINDS),
  // Zenn article files (publish/zenn/), synced to the repository in the ZENN_REPO variable
  zenn: z
    .object({
      enabled: z.boolean().default(true),
      published: z.boolean().default(false), // false = the article stays a draft on Zenn
      topics: z.array(z.string()).default(["ai", "tech"]),
      kinds: z.array(ReportKindSchema).default(PERIODIC_REPORT_KINDS),
    })
    .prefault({}),
  // note.com drafts (publish/note/; created on note.com too when NOTE_API_TOKEN is set)
  note: z
    .object({
      enabled: z.boolean().default(true),
      kinds: z.array(ReportKindSchema).default(PERIODIC_REPORT_KINDS),
    })
    .prefault({}),
  // Daily audio briefing (script always; MP3 when edge-tts is installed)
  podcast: z
    .object({
      enabled: z.boolean().default(true),
      // edge-tts voices per output language; an unlisted language uses "en"
      voices: z.record(z.string(), z.object({ host_a: z.string(), host_b: z.string() })).default({
        ja: { host_a: "ja-JP-KeitaNeural", host_b: "ja-JP-NanamiNeural" },
        en: { host_a: "en-US-GuyNeural", host_b: "en-US-JennyNeural" },
      }),
    })
    .prefault({}),
});

export type PublishingConfig = z.infer<typeof PublishingSchema>;

// --- Insights (keyword expansion and trend analysis) ---
export const InsightsSchema = z.object({
  enabled: z.boolean().default(true),
  // Keyword suggestions: titles of the last `keyword_window_days` compared with the
  // `background_days` before them (state DB `processed_urls`)
  keyword_window_days: z.number().int().positive().default(30),
  background_days: z.number().int().positive().default(60),
  min_document_frequency: z.number().int().positive().default(3),
  // Topic trends over the daily summaries of the last `trend_window_days`
  trend_window_days: z.number().int().positive().default(30),
});

export type InsightsConfig = z.infer<typeof InsightsSchema>;

// --- Main Config Schema ---
export const ConfigSchema = z.object({
  version: z.string(),
  settings: z.object({
    daily_threshold_score: z.number().default(0),
    models: ModelProviderSchema.default({
      platform: "google",
      map: "gemini-2.0-flash",
      reduce: "gemini-2.0-pro",
      thinking: false,
    }),
    fallback_models: FallbackModelSchema,
    author: z.string().default("sun.flat.yamada"),
    // Item 2.5: Freshness scoring
    freshness: z
      .object({
        enabled: z.boolean().default(true),
        decay_lambda: z.number().default(0.02), // exponential decay factor
        max_age_hours: z.number().default(72),
      })
      .default({ enabled: true, decay_lambda: 0.02, max_age_hours: 72 }),
    // Item 5.2: State TTL
    state_ttl_days: z.number().default(90),
    // Plan ST-2: articles evaluated but not summarized are not re-fetched for this many days
    evaluated_ttl_days: z.number().int().positive().default(7),
    // Plan 2-1: batch LLM triage of titles/descriptions before any body is fetched
    // (see filtering/llm_triage.ts). When it fails, the run falls back to the keyword pre-screen.
    triage: z
      .object({
        enabled: z.boolean().default(true),
        model: z.string().optional(), // defaults to models.map
        max_candidates: z.number().int().positive().default(30), // candidates whose body is fetched
        batch_size: z.number().int().positive().default(150), // candidates per LLM call
        min_relevance: z.number().min(0).max(100).default(50), // below this a candidate is dropped
      })
      .default({ enabled: true, max_candidates: 30, batch_size: 150, min_relevance: 50 }),
    // Item 2.4: Semantic deduplication
    semantic_dedup: z
      .object({
        enabled: z.boolean().default(false),
        similarity_threshold: z.number().default(0.92),
      })
      .default({ enabled: false, similarity_threshold: 0.92 }),
    // Output language (default: "en")
    language: z.string().default("en"),
    // Publication gate: a run below these limits is "degraded" — it is not published,
    // its URLs are not marked as processed, and the job fails (see evaluation/run_gate.ts).
    quality_gate: z
      .object({
        min_map_success_rate: z.number().min(0).max(1).default(0.5), // share of selected articles with extracted facts
        min_quality_score: z.number().min(0).max(100).default(60), // evaluateQuality() overall score
      })
      .default({ min_map_success_rate: 0.5, min_quality_score: 60 }),
    publishing: PublishingSchema.prefault({}),
    insights: InsightsSchema.prefault({}),
  }),
  purposes: z.record(z.string(), PurposeSchema),
  exclude: ExcludeSchema,
});

export type AppConfig = z.infer<typeof ConfigSchema>;

// --- Environment Variables (Secrets) ---
// Item 1.2: Added fallback provider keys
// Item 4.3: Added Langfuse keys
export const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY must be set"),
  RAINDROP_TEST_TOKEN: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  NOTE_API_TOKEN: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  // Multi-LLM fallback (Item 1.2)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Slack / Teams (Item 6.4)
  SLACK_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  TEAMS_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  // Email / SMTP Notification
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.preprocess(
    (val) => (val === "" || val === undefined ? 587 : Number(val)),
    z.number().int().positive().default(587),
  ),
  SMTP_SECURE: z.preprocess((val) => (val === "true" || val === true ? true : false), z.boolean().default(false)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_TO: z.string().optional(),
  // Langfuse (Item 4.3)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().optional(),
  // Firecrawl (Item 2.1)
  FIRECRAWL_API_KEY: z.string().optional(),
  JINA_API_KEY: z.string().optional(), // Optional: higher Jina Reader rate limit
  // YouTube (Item 2.3)
  YOUTUBE_API_KEY: z.string().optional(),
  // Concurrency & Rate Limiting (Defaults configured for Free Tier: 5 RPM)
  API_CONCURRENCY: z.preprocess(
    (val) => (val === "" || val === undefined ? 1 : Number(val)),
    z.number().int().positive().default(1),
  ),
  API_INTERVAL_MS: z.preprocess(
    (val) => (val === "" || val === undefined ? 13000 : Number(val)),
    z.number().int().nonnegative().default(13000),
  ),
  // Output language specification (default: "en")
  OUTPUT_LANGUAGE: z.string().default("en"),
  SUMMARY_LANGUAGE: z.string().optional(),
  // AI Model overrides (Item: Cost-effective model configuration)
  AI_MODEL_MAP: z.string().optional(),
  AI_MODEL_REDUCE: z.string().optional(),
  AI_MODEL_PLATFORM: z.string().optional(),
  GEMINI_MAP_MODEL: z.string().optional(),
  GEMINI_REDUCE_MODEL: z.string().optional(),
  // Dry run: ingest, extract and score, then stop before the Map phase (no publishing)
  DRY_RUN: z.preprocess((val) => (val === "true" || val === true ? true : false), z.boolean().default(false)),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

// --- Articles ---

/** Engagement signals a source reports for an article. Kept out of the title. */
export interface ArticleEngagement {
  /** Hacker News points or Reddit upvotes. */
  score?: number;
  /** Bluesky likes. */
  likes?: number;
  /** GitHub stars gained today. */
  starsToday?: number;
}

/** One article (or post, video, repository) as fetched from a source, before body extraction. */
export interface ArticleItem {
  sourceName: string;
  sourceType: string;
  purpose: string; // Links to a key in config.purposes
  /** The title as published, without source-specific decoration. */
  title: string;
  url: string;
  publishedAt: string;
  language?: string; // Item 2.6: Multi-language ingestion
  description?: string; // Plain-text summary from the source; used when content extraction fails
  /** Author or channel, when the source names one (e.g. the YouTube channel). */
  author?: string;
  engagement?: ArticleEngagement;
}
