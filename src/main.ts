/**
 * Main pipeline orchestrator for Digital Trend Flow.
 * Implements all 36 improvement items across 8 categories.
 */

import * as fs from "fs";
import * as path from "path";
import { config, env } from "./core/config";
import { metrics, SOURCE_ALERT_STREAK, type RunStatus } from "./core/metrics";
import { initLangfuse, createTrace, recordQualityScore, flushLangfuse } from "./core/langfuse";
import { registry } from "./core/plugin_registry";
import { fetchRss, ArticleItem } from "./ingestion/rss";
import {
  fetchRaindropBookmarks,
  archiveProcessedRaindrops,
  archivableRaindropIds,
  type RaindropFetchResult,
} from "./ingestion/raindrop";
import { fetchXViGrok } from "./ingestion/xai_grok";
import { sourceDisabledReason } from "./ingestion/source_availability";
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
import { saveMarkdownFile, extractTopStoryTitle, SummaryFrontmatter } from "./storage/markdown_builder";
import { saveDailyCanvas } from "./storage/canvas_builder";
import { extractMentionedCompanies, extractMentionedTechnologies } from "./storage/obsidian_linker";
import { notifyDiscord } from "./publishing/discord_notifier";
import { notifySlack } from "./publishing/slack_notifier";
import { notifyTeams } from "./publishing/teams_notifier";
import { notifyEmail } from "./publishing/email_notifier";
import { generatePagesSite } from "./publishing/pages_generator";
import { generatePodcast } from "./publishing/podcast_generator";
import { evaluateQuality } from "./evaluation/quality_checker";
import { evaluateRunGate, RunGateResult } from "./evaluation/run_gate";
import { analyzeTopicTrends, formatTrendAnalysis } from "./aggregation/trend_analyzer";
import {
  markAsProcessed,
  flushState,
  savePipelineRun,
  recordSourceHealth,
  getSourceFailureStreak,
  closeDb,
} from "./ingestion/state_manager";
import { Purpose, Source } from "./core/types";
import { PATHS } from "./core/paths";
import { dedupeByUrl } from "./core/url";
import { mapWithConcurrency } from "./core/concurrency";

// ── Types for pipeline internal state ──

interface ScoredArticle {
  article: ArticleData;
  sourceName: string;
  score: number;
  purpose: string;
  purposeLabel: string;
  matchedKeywords: string[];
}

const errorMessageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

/**
 * Main pipeline orchestrator. Resolves with the run status; a "degraded" run publishes nothing.
 */
async function main(): Promise<RunStatus> {
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

  // Disabled sources are recorded as such, so they do not count as failing feeds.
  const activeSources: typeof flatSources = [];
  for (const source of flatSources) {
    const reason = sourceDisabledReason(source);
    if (reason === null) {
      activeSources.push(source);
      continue;
    }
    console.log(`  ⏸️ Source "${source.name}" disabled: ${reason}`);
    recordSourceHealth(source.name, source.type, "disabled", 0, reason);
    metrics.recordSourceStatus({ name: source.name, type: source.type, status: "disabled", article_count: 0, error_message: reason });
  }

  const raindropResultSets: (RaindropFetchResult & { collectionId: number; archiveId: number | undefined })[] = [];
  const fetchSource = async (s: Source & { purpose: string }): Promise<ArticleItem[]> => {
    switch (s.type) {
      case "rss":
        return fetchRss(s.name, s.url, s.purpose);
      case "raindrop": {
        const result = await fetchRaindropBookmarks(s.collection_id, s.name, s.lookback_hours, s.purpose);
        raindropResultSets.push({ ...result, collectionId: s.collection_id, archiveId: s.archive_collection_id });
        return result.articles;
      }
      case "xai_grok":
        return fetchXViGrok(s.query, s.name, s.purpose);
      case "hackernews":
        return fetchHackerNews(s.name, s.min_score, s.max_items, s.purpose);
      case "arxiv":
        return fetchArxiv(s.query, s.name, s.max_results, s.purpose);
      case "youtube":
        return fetchYouTube(s.name, s.query, s.channel_id, s.max_results, s.purpose);
      case "github_trending":
        return fetchGitHubTrending(s.name, s.language_filter, s.since, s.purpose);
      case "reddit":
        return fetchReddit(s.subreddit, s.min_score, s.max_items, s.purpose);
      case "bluesky":
        return fetchBluesky(s.query, s.min_likes, s.max_items, s.purpose);
    }
  };

  // Fetchers throw on failure, so a broken feed is reported as an error rather than as "empty".
  const fetchResults = await Promise.allSettled(activeSources.map(fetchSource));

  const allNewItems: ArticleItem[] = [];
  fetchResults.forEach((result, i) => {
    const source = activeSources[i]!;
    const status = result.status === "rejected" ? "error" : result.value.length > 0 ? "ok" : "empty";
    const articleCount = result.status === "fulfilled" ? result.value.length : 0;
    const errorMessage = result.status === "rejected" ? errorMessageOf(result.reason) : undefined;
    if (result.status === "fulfilled") {
      allNewItems.push(...result.value);
    } else {
      console.warn(`⚠️ Source "${source.name}" failed: ${errorMessage}`);
      metrics.recordError(`Source "${source.name}": ${errorMessage}`);
    }

    // Item 2.2: Record source health and alert on consecutive failures (error or empty)
    recordSourceHealth(source.name, source.type, status, articleCount, errorMessage);
    const failureStreak = status === "ok" ? 0 : getSourceFailureStreak(source.name);
    if (failureStreak >= SOURCE_ALERT_STREAK) {
      console.warn(`⚠️ ALERT: "${source.name}" has failed or returned 0 articles for ${failureStreak} consecutive runs!`);
    }
    metrics.recordSourceStatus({
      name: source.name,
      type: source.type,
      status,
      article_count: articleCount,
      failure_streak: failureStreak,
      ...(errorMessage !== undefined ? { error_message: errorMessage } : {}),
    });
  });

  // The same story often arrives from several sources (RSS + HN + Raindrop) or with different
  // tracking parameters; extract and score each canonical URL only once.
  const uniqueItems = dedupeByUrl(allNewItems);
  const duplicateCount = allNewItems.length - uniqueItems.length;
  console.log(
    `  → Found ${uniqueItems.length} new (unprocessed) articles` +
      (duplicateCount > 0 ? ` (${duplicateCount} duplicate URLs dropped).` : ".")
  );
  await registry.events.emit("ingestion:complete", { count: uniqueItems.length });

  if (uniqueItems.length === 0) {
    return finishSkipped("No new articles found today.");
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
    uniqueItems,
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

      let content: string;
      try {
        content = await extractMarkdown(normalizedUrl);
        metrics.recordExtraction("ok");
      } catch (error) {
        const reason = errorMessageOf(error);
        if (!item.description) {
          metrics.recordExtraction("failed");
          console.log(`  ⚠️ Extraction failed: "${item.title}" (${reason})`);
          return null;
        }
        // Score and summarize from the source's own summary instead of dropping the article.
        metrics.recordExtraction("fallback");
        console.log(`  ↩️ Extraction failed, using the source description: "${item.title}" (${reason})`);
        content = `${item.title}\n\n${item.description}`;
      }

      const articleData: ArticleData = {
        url: normalizedUrl,
        title: item.title,
        content,
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
        sourceName: item.sourceName,
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
    metrics.setArticleCounts(uniqueItems.length, 0, 0);
    return finishSkipped("No articles met the quality threshold.");
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

  metrics.setArticleCounts(uniqueItems.length, allScoredArticles.length, selectedArticles.length);
  await registry.events.emit("scoring:complete", { selected: selectedArticles.length });

  if (selectedArticles.length === 0) {
    return finishSkipped("No articles were selected after quota balancing.");
  }

  if (env.DRY_RUN) {
    for (const sa of selectedArticles) {
      console.log(`  🧪 [${sa.purposeLabel}] ${sa.article.title} (score: ${sa.score.toFixed(1)}) ${sa.article.url}`);
    }
    return finishSkipped(`Dry run: stopped after selecting ${selectedArticles.length} articles; no LLM summary was generated and nothing was published.`);
  }

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

  // Only articles whose facts were extracted go on to Reduce, are published and are marked as
  // processed. Failed ones are left unprocessed so the next run retries them.
  const allFacts: (MapOutput & { purpose: string; purposeLabel: string; score: number })[] = [];
  const summarizedArticles: ScoredArticle[] = [];
  for (let i = 0; i < mapResults.length; i++) {
    const result = mapResults[i];
    const sa = selectedArticles[i];
    if (!result || !sa) continue;
    if (result.status === "fulfilled") {
      allFacts.push({
        ...result.value,
        purpose: sa.purpose,
        purposeLabel: sa.purposeLabel,
        score: sa.score,
      });
      summarizedArticles.push(sa);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`⚠️ Map extraction failed for ${sa.article.url}: ${reason}`);
      metrics.recordError(`Map failed for ${sa.article.url}: ${reason}`);
    }
  }

  metrics.setMapResults(selectedArticles.length, allFacts.length);
  console.log(`  → Extracted facts from ${allFacts.length}/${selectedArticles.length} articles.`);
  await registry.events.emit("map:complete", { factCount: allFacts.length });

  const gateThresholds = {
    minMapSuccessRate: config.settings.quality_gate.min_map_success_rate,
    minQualityScore: config.settings.quality_gate.min_quality_score,
  };

  if (allFacts.length === 0) {
    // Nothing grounded to summarize: skip Reduce instead of summarizing titles alone.
    return finishDegraded(evaluateRunGate({ mapAttempted: selectedArticles.length, mapSucceeded: 0 }, gateThresholds));
  }

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

  const reduceResult = await reduceSummarize(allFacts, today, activePurposes, targetLanguage);
  const summaryMarkdown = reduceResult.markdown;
  console.log(reduceResult.usedFallback ? "  → Reduce failed; raw-facts fallback produced." : "  → Summary generated successfully.");
  await registry.events.emit("reduce:complete", { length: summaryMarkdown.length });

  // ==========================
  // Phase 5: Quality Evaluation (Items 7.2, 8.2)
  // ==========================
  console.log("\n🔍 Phase 5: Quality Evaluation...");

  const expectedUrls = summarizedArticles.map((sa) => sa.article.url);
  const qualityResult = evaluateQuality(summaryMarkdown, expectedUrls, targetLanguage);
  metrics.setQualityScore(qualityResult.overallScore);

  if (trace) recordQualityScore(trace, qualityResult.overallScore);

  console.log(`  📊 Quality Score: ${qualityResult.overallScore.toFixed(1)}/100`);
  for (const check of qualityResult.checks) {
    const icon = check.passed ? "✅" : "❌";
    console.log(`    ${icon} ${check.name}: ${check.detail}`);
  }

  await registry.events.emit("quality:complete", { score: qualityResult.overallScore });

  // Publication gate: a degraded run is not published and leaves its URLs unprocessed.
  const gate = evaluateRunGate(
    {
      mapAttempted: selectedArticles.length,
      mapSucceeded: allFacts.length,
      reduceUsedFallback: reduceResult.usedFallback,
      qualityScore: qualityResult.overallScore,
    },
    gateThresholds
  );
  if (gate.status === "degraded") {
    return finishDegraded(gate);
  }
  metrics.setRunStatus("success");

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
  for (const sa of summarizedArticles) {
    sa.matchedKeywords.forEach((kw) => allKeywords.add(kw));
  }
  const previousDate = new Date(Date.now() - 86_400_000).toISOString().split("T")[0] ?? "";

  // Purpose distribution for metrics
  const purposeDistribution: Record<string, number> = {};
  for (const sa of summarizedArticles) {
    purposeDistribution[sa.purposeLabel] = (purposeDistribution[sa.purposeLabel] ?? 0) + 1;
  }
  metrics.setArticlesByPurpose(purposeDistribution);

  // Find top purpose
  const topPurpose = Object.entries(purposeDistribution)
    .reduce<[string, number] | undefined>((best, entry) => (best === undefined || entry[1] > best[1] ? entry : best), undefined)?.[0] ?? "";
  // Highest-scoring article, without reordering summarizedArticles
  const topArticle = summarizedArticles.reduce<ScoredArticle | undefined>(
    (best, sa) => (best === undefined || sa.score > best.score ? sa : best),
    undefined
  );

  const frontmatterMeta: SummaryFrontmatter = {
    tags: Array.from(allKeywords).slice(0, 20),
    categories: activePurposes.map((p) => p.label),
    sources: [...new Set(summarizedArticles.map((sa) => sa.sourceName))],
    // The headline the summary actually leads with; the top-scored title if it has none.
    topStory: extractTopStoryTitle(summaryMarkdown) ?? topArticle?.article.title,
    previousDate,
    // Item 6.3: DataView extensions
    articleCount: summarizedArticles.length,
    topPurpose,
    mentionedCompanies: extractMentionedCompanies(summaryMarkdown),
    mentionedTechnologies: extractMentionedTechnologies(summaryMarkdown),
    estimatedCostUsd: finalMetrics.total_cost_usd,
    executionTimeSec: (finalMetrics.duration_ms ?? 0) / 1000,
    totalTokens: finalMetrics.total_tokens,
    qualityScore: qualityResult.overallScore,
    language: targetLanguage,
  };

  const outputDir = path.join(PATHS.ARTIFACTS_DAILY.absolute, yyyy, mm);
  saveMarkdownFile(outputDir, filename, title, summaryMarkdown, summarizedArticles.length, config.settings.author, frontmatterMeta);

  // Item B: Generate and save Obsidian JSON Canvas
  try {
    const canvasPurposes = activePurposes.map((p) => ({
      key: p.key,
      label: p.label,
      articles: summarizedArticles
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
      topStoryUrl: topArticle?.article.url,
      purposeGroups: canvasPurposes,
      mentionedCompanies: frontmatterMeta.mentionedCompanies,
      mentionedTechnologies: frontmatterMeta.mentionedTechnologies,
      outputDir,
    });
  } catch (canvasErr: any) {
    console.warn(`⚠️ Obsidian Canvas generation failed: ${canvasErr.message}`);
  }

  // Publishing (Items 6.4, 6.5)
  await notifyDiscord(title, summaryMarkdown, summarizedArticles.length);
  await notifySlack(title, summaryMarkdown, summarizedArticles.length);
  await notifyTeams(title, summaryMarkdown, summarizedArticles.length);
  await notifyEmail(title, summaryMarkdown, summarizedArticles.length);

  // GitHub Pages static site generation (also writes the Atom feed, Item 6.5)
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
  for (const sa of summarizedArticles) {
    markAsProcessed(sa.article.url, sa.article.title, sa.score, sa.purpose);
  }

  // Archive Raindrop items
  const summarizedUrls = summarizedArticles.map((sa) => sa.article.url);
  for (const rs of raindropResultSets) {
    const archiveIds = archivableRaindropIds(rs, summarizedUrls);
    if (archiveIds.length > 0) {
      await archiveProcessedRaindrops(rs.collectionId, archiveIds, rs.archiveId);
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
  writeStepSummary();

  // Cost summary
  console.log(`\n💰 Total LLM Cost: $${finalMetrics.total_cost_usd.toFixed(4)}`);
  console.log(`   Tokens: ${finalMetrics.total_tokens.input.toLocaleString()} in / ${finalMetrics.total_tokens.output.toLocaleString()} out`);

  await registry.events.emit("pipeline:complete", {
    articles: summarizedArticles.length,
    cost: finalMetrics.total_cost_usd,
    quality: qualityResult.overallScore,
  });

  console.log(`\n🎉 Pipeline complete! Processed ${summarizedArticles.length} articles across ${activePurposes.length} categories.`);
  return "success";
}

// ── Degraded Run Handling ──

/**
 * Ends a run that failed the publication gate: nothing is published, no URL is marked as
 * processed (so the articles are retried by the next run) and Raindrop items stay in the inbox.
 * The metrics and the run record are still saved so the failure is visible.
 */
async function finishDegraded(gate: RunGateResult): Promise<RunStatus> {
  console.error("\n🚫 Run degraded — nothing was published and no URL was marked as processed:");
  for (const reason of gate.reasons) {
    console.error(`   - ${reason}`);
  }

  metrics.setRunStatus("degraded", gate.reasons);
  savePipelineRun(metrics.finalize());
  metrics.persist();
  writeStepSummary();

  await registry.events.emit("pipeline:error", { status: "degraded", reasons: gate.reasons });
  return "degraded";
}

/**
 * Ends a run that had nothing to summarize. The run record and the job summary are still
 * written, because a skipped run is often the symptom of failing sources.
 */
function finishSkipped(reason: string): RunStatus {
  console.log(`ℹ️ ${reason} Pipeline complete.`);
  metrics.setRunStatus("skipped", [reason]);
  savePipelineRun(metrics.finalize());
  writeStepSummary();
  return "skipped";
}

// ── GitHub Actions Integration ──

/** Appends the metrics summary to the GitHub Actions job summary, when running in Actions. */
function writeStepSummary(): void {
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, metrics.toGitHubSummary(), "utf8");
  console.log("📊 GitHub Actions summary written.");
}

/** Exposes a step output (e.g. `run_status`) to later workflow steps, when running in Actions. */
function writeGitHubOutput(key: string, value: string): void {
  const outputPath = process.env["GITHUB_OUTPUT"];
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${key}=${value}\n`, "utf8");
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

// A degraded run exits non-zero so the job fails visibly; the workflow reads the `run_status`
// step output to still commit the run record (see .github/workflows/daily_summary.yml).
const EXIT_CODE_DEGRADED = 2;

main()
  .then(async (status) => {
    await cleanup();
    writeGitHubOutput("run_status", status);
    process.exit(status === "degraded" ? EXIT_CODE_DEGRADED : 0);
  })
  .catch(async (err) => {
    await cleanup();
    console.error("💀 Fatal pipeline error:", err);
    metrics.recordError(`Fatal: ${err.message ?? err}`);
    registry.events.emit("pipeline:error", { error: String(err) }).catch(() => {});
    writeGitHubOutput("run_status", "failed");
    process.exit(1);
  });
