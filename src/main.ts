/**
 * Main pipeline orchestrator for Digital Trend Flow.
 * Implements all 36 improvement items across 8 categories.
 */

import * as path from "path";
import { config, env } from "./core/config";
import { metrics } from "./core/metrics";
import { initLangfuse, createTrace, recordQualityScore, flushLangfuse } from "./core/langfuse";
import { registry } from "./core/plugin_registry";
import { fetchRss, ArticleItem } from "./ingestion/rss";
import { fetchRaindropBookmarks, archiveProcessedRaindrops } from "./ingestion/raindrop";
import { fetchXViGrok } from "./ingestion/xai_grok";
import { extractMarkdown } from "./ingestion/jina_reader";
import { fetchHackerNews } from "./ingestion/hackernews";
import { fetchArxiv } from "./ingestion/arxiv";
import { fetchYouTube } from "./ingestion/youtube";
import { fetchGitHubTrending } from "./ingestion/github_trending";
import { fetchReddit } from "./ingestion/reddit";
import { fetchBluesky } from "./ingestion/bluesky";
import {
  calculatePurposeScore,
  assignBestPurpose,
  normalizeUrl,
  ArticleData,
  PurposeScoreOutput,
  excludeByMetadata,
  titlePassesPreScreen,
  llmJudgeScore,
  combineWithJudgeScore,
} from "./filtering/scorer";
import { semanticDedup } from "./filtering/semantic_dedup";
import { discoverCandidateKeywords, formatSuggestionReport } from "./filtering/keyword_expansion";
import { mapExtractFacts, MapInput, MapOutput } from "./summarization/gemini_map";
import { reduceSummarize } from "./summarization/gemini_reduce";
import { saveMarkdownFile, SummaryFrontmatter } from "./storage/markdown_builder";
import { saveDailyCanvas } from "./storage/canvas_builder";
import { extractMentionedCompanies, extractMentionedTechnologies } from "./storage/obsidian_linker";
import { notifyDiscord } from "./publishing/discord_notifier";
import { notifySlack } from "./publishing/slack_notifier";
import { notifyTeams } from "./publishing/teams_notifier";
import { generateAtomFeed } from "./publishing/feed_generator";
import { generatePagesSite } from "./publishing/pages_generator";
import { generatePodcast } from "./publishing/podcast_generator";
import { evaluateQuality } from "./evaluation/quality_checker";
import { analyzeTopicTrends, formatTrendAnalysis } from "./aggregation/trend_analyzer";
import {
  markAsProcessed,
  flushState,
  savePipelineRun,
  recordSourceHealth,
  getSourceEmptyStreak,
  closeDb,
} from "./ingestion/state_manager";
import { Purpose, Source } from "./core/types";
import { PATHS } from "./core/paths";

// ── Types for pipeline internal state ──

interface ScoredArticle {
  article: ArticleData;
  score: number;
  purpose: string;
  purposeLabel: string;
  matchedKeywords: string[];
}

// ── Concurrency & Rate Limiting utility ──

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = env.API_CONCURRENCY,
  intervalMs: number = env.API_INTERVAL_MS
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    if (i > 0 && intervalMs > 0) {
      await sleep(intervalMs);
    }
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

/**
 * Main pipeline orchestrator.
 */
async function main() {
  const today = new Date().toISOString().split("T")[0] ?? "unknown-date";
  console.log(`\n🚀 Digital Trend Flow - Daily Pipeline Starting (${today})...`);
  console.log(`   ⚙️ API Concurrency: ${env.API_CONCURRENCY}, Interval: ${env.API_INTERVAL_MS}ms\n`);

  // Initialize Langfuse tracing (Item 4.3)
  initLangfuse();
  const trace = createTrace(metrics.getSnapshot().run_id, today);

  // Emit pipeline start event (Item 8.4)
  await registry.events.emit("ingestion:start", { date: today });

  // ==========================
  // Phase 1: Ingestion (Items 2.1-2.6)
  // ==========================
  console.log("📥 Phase 1: Ingestion - Fetching new articles from sources...");

  // Flatten Sources
  const flatSources: (Source & { purpose: string })[] = [];
  for (const [purposeKey, purposeDef] of Object.entries(config.purposes)) {
    for (const source of purposeDef.sources || []) {
      flatSources.push({ ...source, purpose: purposeKey });
    }
  }

  // 1a. RSS Sources
  const rssSources = flatSources.filter((s) => s.type === "rss");
  const rssResults = await Promise.allSettled(
    rssSources.map((s) => {
      if (s.type === "rss") return fetchRss(s.name, s.url, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // 1b. Raindrop Sources
  const raindropSources = flatSources.filter((s) => s.type === "raindrop");
  const raindropResultSets: { articles: ArticleItem[]; raindropIds: number[]; collectionId: number; archiveId: number | undefined }[] = [];
  const raindropResults = await Promise.allSettled(
    raindropSources.map(async (s) => {
      if (s.type === "raindrop") {
        const result = await fetchRaindropBookmarks(s.collection_id, s.name, s.lookback_hours, s.purpose);
        raindropResultSets.push({
          ...result,
          collectionId: s.collection_id,
          archiveId: s.archive_collection_id,
        });
        return result.articles;
      }
      return [] as ArticleItem[];
    })
  );

  // 1c. X/Grok Sources
  const grokSources = flatSources.filter((s) => s.type === "xai_grok");
  const grokResults = await Promise.allSettled(
    grokSources.map((s) => {
      if (s.type === "xai_grok") return fetchXViGrok(s.query, s.name, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // 1d. Hacker News Sources (Item 2.3)
  const hnSources = flatSources.filter((s) => s.type === "hackernews");
  const hnResults = await Promise.allSettled(
    hnSources.map((s) => {
      if (s.type === "hackernews") return fetchHackerNews(s.name, s.min_score, s.max_items, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // 1e. arXiv Sources (Item 2.3)
  const arxivSources = flatSources.filter((s) => s.type === "arxiv");
  const arxivResults = await Promise.allSettled(
    arxivSources.map((s) => {
      if (s.type === "arxiv") return fetchArxiv(s.query, s.name, s.max_results, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // 1f. YouTube Sources (Item 2.3)
  const ytSources = flatSources.filter((s) => s.type === "youtube");
  const ytResults = await Promise.allSettled(
    ytSources.map((s) => {
      if (s.type === "youtube") return fetchYouTube(s.name, s.query, s.channel_id, s.max_results, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // 1g. GitHub Trending Sources (Item 2.3)
  const ghSources = flatSources.filter((s) => s.type === "github_trending");
  const ghResults = await Promise.allSettled(
    ghSources.map((s) => {
      if (s.type === "github_trending") return fetchGitHubTrending(s.name, s.language_filter, s.since, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // 1h. Reddit Sources (Item D)
  const redditSources = flatSources.filter((s) => s.type === "reddit");
  const redditResults = await Promise.allSettled(
    redditSources.map((s) => {
      if (s.type === "reddit") return fetchReddit(s.subreddit, s.min_score, s.max_items, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // 1i. Bluesky Sources (Item D)
  const bskySources = flatSources.filter((s) => s.type === "bluesky");
  const bskyResults = await Promise.allSettled(
    bskySources.map((s) => {
      if (s.type === "bluesky") return fetchBluesky(s.query, s.min_likes, s.max_items, s.purpose);
      return Promise.resolve([] as ArticleItem[]);
    })
  );

  // Flatten all results with source health tracking (Item 2.2)
  const allResultSets: Array<{ results: PromiseSettledResult<ArticleItem[]>[]; sources: typeof flatSources }> = [
    { results: rssResults, sources: rssSources },
    { results: raindropResults, sources: raindropSources },
    { results: grokResults, sources: grokSources },
    { results: hnResults, sources: hnSources },
    { results: arxivResults, sources: arxivSources },
    { results: ytResults, sources: ytSources },
    { results: ghResults, sources: ghSources },
    { results: redditResults, sources: redditSources },
    { results: bskyResults, sources: bskySources },
  ];

  const allNewItems: ArticleItem[] = [];
  for (const { results, sources } of allResultSets) {
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const source = sources[i]!;
      if (result.status === "fulfilled") {
        allNewItems.push(...result.value);
        // Item 2.2: Record source health
        recordSourceHealth(
          source.name,
          source.type,
          result.value.length > 0 ? "ok" : "empty",
          result.value.length
        );
        metrics.recordSourceStatus({
          name: source.name,
          type: source.type,
          status: result.value.length > 0 ? "ok" : "empty",
          article_count: result.value.length,
        });
        // Item 2.2: Alert on consecutive empty feeds
        if (result.value.length === 0) {
          const streak = getSourceEmptyStreak(source.name);
          if (streak >= 3) {
            console.warn(`⚠️ ALERT: "${source.name}" has returned 0 articles for ${streak} consecutive days!`);
            metrics.recordError(`Source "${source.name}" empty for ${streak} days`);
          }
        }
      } else {
        console.warn(`⚠️ Source "${source.name}" failed: ${result.reason}`);
        recordSourceHealth(source.name, source.type, "error", 0, String(result.reason));
        metrics.recordSourceStatus({
          name: source.name,
          type: source.type,
          status: "error",
          article_count: 0,
          error_message: String(result.reason),
        });
        metrics.recordError(`Source "${source.name}": ${result.reason}`);
      }
    }
  }

  console.log(`  → Found ${allNewItems.length} new (unprocessed) articles.`);
  await registry.events.emit("ingestion:complete", { count: allNewItems.length });

  if (allNewItems.length === 0) {
    console.log("ℹ️ No new articles found today. Pipeline complete.");
    return;
  }

  // ==========================
  // Phase 2: Extraction, Scoring & Purpose-Based Selection
  // ==========================
  console.log("\n🔍 Phase 2: Extraction, Scoring & Purpose-Based Selection...");

  const allScoredArticles: ScoredArticle[] = [];
  const allTitles: string[] = []; // For keyword expansion (Item 3.2)

  // Available categories for LLM Judge (Item 3.1)
  const availableCategories = Object.entries(config.purposes)
    .map(([key, p]) => `${key}: ${p.label}`)
    .filter((_, i) => i < 10);

  const extractionResults = await mapWithConcurrency(
    allNewItems,
    async (item) => {
      const normalizedUrl = normalizeUrl(item.url);

      // Metadata pre-filter
      const metadataCheck = excludeByMetadata(item.title, normalizedUrl);
      if (metadataCheck.excluded) {
        console.log(`  ❌ Pre-excluded (Metadata): "${item.title}" (${metadataCheck.reason})`);
        return null;
      }

      // Title pre-screening
      if (!titlePassesPreScreen(item.title, item.purpose)) {
        console.log(`  ⏭️ Pre-skipped (no title keywords): "${item.title}"`);
        return null;
      }

      const markdown = await extractMarkdown(normalizedUrl);

      const articleData: ArticleData = {
        url: normalizedUrl,
        title: item.title,
        content: markdown,
        publishedAt: item.publishedAt, // Item 2.5: freshness
        ...(item.language !== undefined ? { language: item.language } : {}), // Item 2.6
      };

      // Score against purpose
      let scoreResult: PurposeScoreOutput;
      if (item.purpose === "curated") {
        scoreResult = assignBestPurpose(articleData);
      } else {
        scoreResult = calculatePurposeScore(articleData, item.purpose);
      }

      if (scoreResult.isExcluded) {
        console.log(`  ❌ Excluded: "${item.title}" (${scoreResult.exclusionReason})`);
        return null;
      }

      // Item 3.1: LLM-as-Judge scoring (if enabled)
      let finalScore = scoreResult.totalScore;
      if (config.settings.llm_judge.enabled) {
        const judgeResult = await llmJudgeScore(articleData, availableCategories);
        finalScore = combineWithJudgeScore(finalScore, judgeResult);
      }

      // Check threshold
      const purposeDef = config.purposes[scoreResult.assignedPurpose];
      const threshold = purposeDef?.scoring?.threshold ?? config.settings.daily_threshold_score;

      if (finalScore < threshold) {
        console.log(`  ⬇️ Below threshold [${scoreResult.purposeLabel}]: "${item.title}" (score: ${finalScore.toFixed(1)} < ${threshold})`);
        return null;
      }

      allTitles.push(item.title);
      console.log(`  ✅ [${scoreResult.purposeLabel}] "${item.title}" (score: ${finalScore.toFixed(1)})`);
      return {
        article: articleData,
        score: finalScore,
        purpose: scoreResult.assignedPurpose,
        purposeLabel: scoreResult.purposeLabel,
        matchedKeywords: scoreResult.matchedKeywords,
      };
    },
    Math.max(env.API_CONCURRENCY, 3),
    200
  );

  for (const result of extractionResults) {
    if (result.status === "fulfilled" && result.value) {
      allScoredArticles.push(result.value);
    }
  }

  console.log(`  → ${allScoredArticles.length} articles passed scoring.`);

  if (allScoredArticles.length === 0) {
    console.log("ℹ️ No articles met the quality threshold. Pipeline complete.");
    return;
  }

  // Item 2.4: Semantic deduplication
  // Transform to dedup-compatible shape, then map back
  const dedupCandidates = allScoredArticles.map((sa) => ({
    url: sa.article.url,
    title: sa.article.title,
    score: sa.score,
    purpose: sa.purpose,
    _original: sa,
  }));
  const dedupedCandidates = semanticDedup(dedupCandidates);
  const dedupedArticles = dedupedCandidates.map((c) => c._original);

  // Two-Pass Quota Selection
  const selectedArticles = twoPassSelect(dedupedArticles);
  console.log(`  → ${selectedArticles.length} articles selected after quota balancing.`);

  metrics.setArticleCounts(allNewItems.length, allScoredArticles.length, selectedArticles.length);
  await registry.events.emit("scoring:complete", { selected: selectedArticles.length });

  // ==========================
  // Phase 3: Map Processing
  // ==========================
  console.log(`\n🗺️ Phase 3: Map Processing - Extracting facts via LLM (concurrency: ${env.API_CONCURRENCY}, interval: ${env.API_INTERVAL_MS}ms)...`);

  const mapInputs: MapInput[] = selectedArticles.map((sa) => ({
    title: sa.article.title,
    url: sa.article.url,
    content: sa.article.content,
    ...(sa.article.language !== undefined ? { language: sa.article.language } : {}),
  }));

  const mapResults = await mapWithConcurrency(mapInputs, mapExtractFacts, env.API_CONCURRENCY, env.API_INTERVAL_MS);

  const allFacts: (MapOutput & { purpose: string; purposeLabel: string; score: number })[] = [];
  for (let i = 0; i < mapResults.length; i++) {
    const result = mapResults[i];
    const sa = selectedArticles[i];
    if (result?.status === "fulfilled" && sa) {
      allFacts.push({
        ...result.value,
        purpose: sa.purpose,
        purposeLabel: sa.purposeLabel,
        score: sa.score,
      });
    }
  }

  console.log(`  → Extracted facts from ${allFacts.length} articles.`);
  await registry.events.emit("map:complete", { factCount: allFacts.length });

  // ==========================
  // Phase 4: Reduce Summarization
  // ==========================
  console.log("\n📝 Phase 4: Reduce Summarization...");

  const activePurposes: { key: string; label: string }[] = [];
  for (const [key, purpose] of Object.entries(config.purposes)) {
    if (allFacts.some((f) => f.purpose === key)) {
      activePurposes.push({ key, label: purpose.label });
    }
  }

  const targetLanguage =
    process.env.OUTPUT_LANGUAGE ||
    process.env.SUMMARY_LANGUAGE ||
    config.settings.language ||
    "en";
  console.log(`  🌐 Output language: ${targetLanguage}`);

  const summaryMarkdown = await reduceSummarize(allFacts, today, activePurposes, targetLanguage);
  console.log("  → Summary generated successfully.");
  await registry.events.emit("reduce:complete", { length: summaryMarkdown.length });

  // ==========================
  // Phase 5: Quality Evaluation (Items 7.2, 8.2)
  // ==========================
  console.log("\n🔍 Phase 5: Quality Evaluation...");

  const expectedUrls = selectedArticles.map((sa) => sa.article.url);
  const qualityResult = evaluateQuality(summaryMarkdown, expectedUrls, targetLanguage);
  metrics.setQualityScore(qualityResult.overallScore);

  if (trace) recordQualityScore(trace, qualityResult.overallScore);

  console.log(`  📊 Quality Score: ${qualityResult.overallScore.toFixed(1)}/100`);
  for (const check of qualityResult.checks) {
    const icon = check.passed ? "✅" : "❌";
    console.log(`    ${icon} ${check.name}: ${check.detail}`);
  }

  await registry.events.emit("quality:complete", { score: qualityResult.overallScore });

  // ==========================
  // Phase 6: Storage & Publishing
  // ==========================
  console.log("\n💾 Phase 6: Storage & Publishing...");

  const [yyyy, mm] = today.split("-") as [string, string, string];
  const filename = `${today}_digital-trend_daily_summary.md`;
  const title = `Daily Summary ${today}`;
  const finalMetrics = metrics.finalize();

  // Build enriched frontmatter (Items 6.3, 8.3)
  const allKeywords = new Set<string>();
  for (const sa of selectedArticles) {
    sa.matchedKeywords.forEach((kw) => allKeywords.add(kw));
  }
  const previousDate = new Date(Date.now() - 86_400_000).toISOString().split("T")[0] ?? "";

  // Purpose distribution for metrics
  const purposeDistribution: Record<string, number> = {};
  for (const sa of selectedArticles) {
    purposeDistribution[sa.purposeLabel] = (purposeDistribution[sa.purposeLabel] ?? 0) + 1;
  }
  metrics.setArticlesByPurpose(purposeDistribution);

  // Find top purpose
  const topPurpose = Object.entries(purposeDistribution)
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? "";

  const frontmatterMeta: SummaryFrontmatter = {
    tags: Array.from(allKeywords).slice(0, 20),
    categories: activePurposes.map((p) => p.label),
    sources: [...new Set(selectedArticles.map((sa) => sa.purpose))],
    topStory: selectedArticles.sort((a, b) => b.score - a.score)[0]?.article.title,
    previousDate,
    // Item 6.3: DataView extensions
    articleCount: selectedArticles.length,
    topPurpose,
    mentionedCompanies: extractMentionedCompanies(summaryMarkdown),
    mentionedTechnologies: extractMentionedTechnologies(summaryMarkdown),
    estimatedCostUsd: finalMetrics.total_cost_usd,
    executionTimeSec: (finalMetrics.duration_ms ?? 0) / 1000,
    qualityScore: qualityResult.overallScore,
    language: targetLanguage,
  };

  const outputDir = path.join(PATHS.ARTIFACTS_DAILY.absolute, yyyy, mm);
  saveMarkdownFile(outputDir, filename, title, summaryMarkdown, selectedArticles.length, config.settings.author, frontmatterMeta);

  // Item B: Generate and save Obsidian JSON Canvas
  try {
    const canvasPurposes = activePurposes.map((p) => ({
      key: p.key,
      label: p.label,
      articles: selectedArticles
        .filter((sa) => sa.purpose === p.key)
        .map((sa) => ({
          title: sa.article.title,
          url: sa.article.url,
          score: sa.score,
        })),
    }));

    saveDailyCanvas({
      date: today,
      topStory: frontmatterMeta.topStory ?? "Daily Tech Trend",
      topStoryUrl: selectedArticles.sort((a, b) => b.score - a.score)[0]?.article.url,
      purposeGroups: canvasPurposes,
      mentionedCompanies: frontmatterMeta.mentionedCompanies,
      mentionedTechnologies: frontmatterMeta.mentionedTechnologies,
      outputDir,
    });
  } catch (canvasErr: any) {
    console.warn(`⚠️ Obsidian Canvas generation failed: ${canvasErr.message}`);
  }

  // Publishing (Items 6.4, 6.5)
  await notifyDiscord(title, summaryMarkdown, selectedArticles.length);
  await notifySlack(title, summaryMarkdown, selectedArticles.length);
  await notifyTeams(title, summaryMarkdown, selectedArticles.length);

  // Item 6.5: Generate RSS feed
  generateAtomFeed();

  // GitHub Pages static site generation
  try {
    generatePagesSite(undefined, undefined, targetLanguage);
  } catch (pagesErr: any) {
    console.warn(`⚠️ GitHub Pages site generation failed: ${pagesErr.message}`);
  }

  // Item C: Generate AI conversational podcast & audio briefing
  try {
    await generatePodcast(summaryMarkdown, today);
  } catch (podcastErr: any) {
    console.warn(`⚠️ Podcast generation failed: ${podcastErr.message}`);
  }

  await registry.events.emit("publish:complete", { channels: ["obsidian", "discord", "slack", "teams", "rss", "pages", "podcast"] });

  // Mark processed URLs
  for (const sa of selectedArticles) {
    markAsProcessed(sa.article.url, sa.article.title, sa.score, sa.purpose);
  }

  // Archive Raindrop items
  for (const rs of raindropResultSets) {
    if (rs.raindropIds.length > 0) {
      await archiveProcessedRaindrops(rs.collectionId, rs.raindropIds, rs.archiveId);
    }
  }

  // Item 5.3: Save pipeline run metrics
  savePipelineRun(finalMetrics);

  // Item 4.2: Persist metrics JSON
  metrics.persist();

  // Item 3.2: Keyword expansion suggestions
  if (allTitles.length >= 10) {
    const suggestions = discoverCandidateKeywords(allTitles);
    if (suggestions.length > 0) {
      console.log("\n🔑 Keyword Expansion Suggestions:");
      for (const s of suggestions.slice(0, 5)) {
        console.log(`    "${s.word}" (${s.frequency}x) → ${s.suggestedPurpose} weight:${s.suggestedWeight}`);
      }
    }
  }

  // Item 8.1: Temporal trend analysis
  const trends = analyzeTopicTrends(30);
  const risingTrends = trends.filter((t) => t.trend === "rising" || t.trend === "new");
  if (risingTrends.length > 0) {
    console.log("\n📈 Rising Trends:");
    for (const t of risingTrends.slice(0, 5)) {
      console.log(`    ${t.trend === "new" ? "🆕" : "📈"} ${t.topic} (${t.totalMentions} mentions)`);
    }
  }

  // Item 4.4: GitHub Actions job summary
  if (process.env["GITHUB_STEP_SUMMARY"]) {
    const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
    const fs = require("fs");
    fs.appendFileSync(summaryPath, metrics.toGitHubSummary(), "utf8");
    console.log("📊 GitHub Actions summary written.");
  }

  // Cost summary
  console.log(`\n💰 Total LLM Cost: $${finalMetrics.total_cost_usd.toFixed(4)}`);
  console.log(`   Tokens: ${finalMetrics.total_tokens.input.toLocaleString()} in / ${finalMetrics.total_tokens.output.toLocaleString()} out`);

  await registry.events.emit("pipeline:complete", {
    articles: selectedArticles.length,
    cost: finalMetrics.total_cost_usd,
    quality: qualityResult.overallScore,
  });

  console.log(`\n🎉 Pipeline complete! Processed ${selectedArticles.length} articles across ${activePurposes.length} categories.`);
}

// ── Two-Pass Quota Selection ──

function twoPassSelect(articles: ScoredArticle[]): ScoredArticle[] {
  const selected: ScoredArticle[] = [];
  const selectedUrls = new Set<string>();

  const byPurpose = new Map<string, ScoredArticle[]>();
  for (const a of articles) {
    const existing = byPurpose.get(a.purpose) ?? [];
    existing.push(a);
    byPurpose.set(a.purpose, existing);
  }

  for (const [, group] of byPurpose) {
    group.sort((a, b) => b.score - a.score);
  }

  const countByPurpose = new Map<string, number>();

  // Pass 1: Guaranteed minimum
  for (const [purposeKey, group] of byPurpose) {
    const purposeDef: Purpose | undefined = config.purposes[purposeKey];
    const minQuota = purposeDef?.quota?.min ?? 0;
    let picked = 0;
    for (const article of group) {
      if (picked >= minQuota) break;
      if (!selectedUrls.has(article.article.url)) {
        selected.push(article);
        selectedUrls.add(article.article.url);
        picked++;
      }
    }
    countByPurpose.set(purposeKey, picked);
    if (picked > 0) {
      console.log(`  📊 [Pass 1] ${purposeDef?.label ?? purposeKey}: ${picked} guaranteed`);
    }
  }

  // Pass 2: Meritocratic overflow
  const remaining: ScoredArticle[] = [];
  for (const a of articles) {
    if (!selectedUrls.has(a.article.url)) remaining.push(a);
  }
  remaining.sort((a, b) => b.score - a.score);

  for (const article of remaining) {
    const purposeDef: Purpose | undefined = config.purposes[article.purpose];
    const maxQuota = purposeDef?.quota?.max ?? 10;
    const currentCount = countByPurpose.get(article.purpose) ?? 0;
    if (currentCount < maxQuota) {
      selected.push(article);
      selectedUrls.add(article.article.url);
      countByPurpose.set(article.purpose, currentCount + 1);
    }
  }

  console.log("  📊 [Pass 2] Final selection:");
  for (const [purposeKey, count] of countByPurpose) {
    const label = config.purposes[purposeKey]?.label ?? purposeKey;
    console.log(`    ${label}: ${count} articles`);
  }

  return selected;
}

async function cleanup(): Promise<void> {
  try {
    flushState();
  } catch (e: any) {
    console.error("⚠️ Failed to flush state:", e.message);
  }
  try {
    await flushLangfuse();
  } catch {
    // Non-fatal
  }
  try {
    closeDb();
  } catch {
    // Non-fatal
  }
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    await cleanup();
    console.error("💀 Fatal pipeline error:", err);
    metrics.recordError(`Fatal: ${err.message ?? err}`);
    registry.events.emit("pipeline:error", { error: String(err) }).catch(() => {});
    process.exit(1);
  });
