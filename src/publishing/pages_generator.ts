/**
 * [Role] GitHub Pages static site generator for Digital Trend Flow.
 * [Mechanism] Scans daily summary Markdown files, extracts frontmatter and content,
 * and compiles a responsive, self-contained web application with:
 *   1. Today's Headline (当日 Head line)
 *   2. Back number Calendar view (カレンダーでの日付選択)
 *   3. Back number List view (バックナンバー一覧・キーワード検索)
 *   4. URL Hash routing (#YYYY-MM-DD)
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { PATHS } from "../core/paths";
import { buildAtomFeed, resolveSiteUrl } from "./feed_generator";
import { errorMessage } from "../core/errors";
import { markdownToHtml } from "./markdown_html";

export { markdownToHtml };

export type ReportType = "daily" | "weekly" | "monthly" | "yearly";

export interface PageSummaryItem {
  id?: string;
  date: string; // "YYYY-MM-DD"
  period?: string; // "2026-W38", "2026-09", "2026", "2026-09-20"
  reportType?: ReportType;
  title: string;
  topStory: string;
  categories: string[];
  tags: string[];
  articleCount: number;
  qualityScore: number | null;
  topPurpose?: string;
  language?: string;
  contentHtml: string;
  rawMarkdown: string;
  sourceUrl?: string;
}

export interface PagesI18n {
  langCode: string;
  pageTitle: string;
  pageDescription: string;
  themeToggleTitle: string;
  tabCalendar: string;
  tabList: string;
  tabReports: string;
  filterAll: string;
  filterWeekly: string;
  filterMonthly: string;
  filterYearly: string;
  reportBadgeDaily: string;
  reportBadgeWeekly: string;
  reportBadgeMonthly: string;
  reportBadgeYearly: string;
  calWeekdays: string[];
  calLegendHasData: string;
  calLegendToday: string;
  calLegendSelected: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  headlineBadge: string;
  articlesLabel: (count: number) => string;
  qualityLabel: (score: string) => string;
  copyLink: string;
  copiedLink: string;
  noDataHeadline: string;
  noDataContent: string;
  noSearchResults: string;
  noReportsFound: string;
  cardArticles: (count: number) => string;
  summaryAvailableTooltip: string;
  monthTitle: (year: number, month: number) => string;
  notFoundTitle: string;
  notFoundDesc: string;
  notFoundBack: string;
  periodLabel: string;
}

export const I18N_EN: PagesI18n = {
  langCode: "en",
  pageTitle: "Digital Trend Flow — Technology Trend Hub",
  pageDescription:
    "AI-powered automated daily digital & tech trend intelligence platform. Browse headlines, weekly reports, and archives.",
  themeToggleTitle: "Toggle dark/light mode",
  tabCalendar: "📅 Calendar",
  tabList: "📋 Archive List",
  tabReports: "📊 Reports",
  filterAll: "All",
  filterWeekly: "Weekly",
  filterMonthly: "Monthly",
  filterYearly: "Yearly",
  reportBadgeDaily: "🌟 TODAY'S HEADLINE",
  reportBadgeWeekly: "📊 WEEKLY REPORT",
  reportBadgeMonthly: "🗓️ MONTHLY DIGEST",
  reportBadgeYearly: "🏆 YEARLY REPORT",
  calWeekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  calLegendHasData: "Has Summary",
  calLegendToday: "Today",
  calLegendSelected: "Selected",
  searchPlaceholder: "Search by title, tag, or category...",
  searchAriaLabel: "Search archive",
  headlineBadge: "🌟 TODAY'S HEADLINE",
  articlesLabel: (count) => `📊 Articles: ${count}`,
  qualityLabel: (score) => `🏆 Quality: ${score}`,
  copyLink: "🔗 Copy Link",
  copiedLink: "Link copied!",
  noDataHeadline: "No headline available for today.",
  noDataContent: '<p class="no-data">No data available. Run the pipeline to generate summaries.</p>',
  noSearchResults: "No matching summaries found",
  noReportsFound: "No periodic reports found",
  cardArticles: (count) => `${count} articles`,
  summaryAvailableTooltip: "Summary available: ",
  monthTitle: (year, month) => {
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return `${monthNames[month]} ${year}`;
  },
  notFoundTitle: "Page Not Found — Digital Trend Flow",
  notFoundDesc: "Redirecting to home page...",
  notFoundBack: "Back to Home",
  periodLabel: "Period",
};

export const I18N_JA: PagesI18n = {
  langCode: "ja",
  pageTitle: "Digital Trend Flow — Technology Trend Hub",
  pageDescription:
    "デジタル・テック動向の自動集約Hub。ヘッドライン、週次・月次レポート、バックナンバーを閲覧できます。",
  themeToggleTitle: "ダーク/ライト切替",
  tabCalendar: "📅 カレンダー",
  tabList: "📋 リスト一覧",
  tabReports: "📊 定期レポート",
  filterAll: "すべて",
  filterWeekly: "週次",
  filterMonthly: "月次",
  filterYearly: "年次",
  reportBadgeDaily: "🌟 当日ヘッドライン",
  reportBadgeWeekly: "📊 週間トレンド分析",
  reportBadgeMonthly: "🗓️ 月次ダイジェスト",
  reportBadgeYearly: "🏆 年間トレンドレポート",
  calWeekdays: ["日", "月", "火", "水", "木", "金", "土"],
  calLegendHasData: "サマリーあり",
  calLegendToday: "本日",
  calLegendSelected: "選択中",
  searchPlaceholder: "タイトルやタグで検索...",
  searchAriaLabel: "バックナンバー検索",
  headlineBadge: "🌟 TODAY'S HEADLINE",
  articlesLabel: (count) => `📊 収集記事: ${count}件`,
  qualityLabel: (score) => `🏆 品質: ${score}`,
  copyLink: "🔗 リンクをコピー",
  copiedLink: "リンクをコピーしました",
  noDataHeadline: "本日のヘッドライン情報はまだありません。",
  noDataContent: '<p class="no-data">データがありません。パイプラインを実行してサマリーを生成してください。</p>',
  noSearchResults: "該当するサマリーはありません",
  noReportsFound: "該当する定期レポートはありません",
  cardArticles: (count) => `${count} 記事`,
  summaryAvailableTooltip: "サマリーあり: ",
  monthTitle: (year, month) => `${year}年 ${String(month + 1).padStart(2, "0")}月`,
  notFoundTitle: "ページが見つかりません — Digital Trend Flow",
  notFoundDesc: "トップページへ自動遷移します...",
  notFoundBack: "トップページへ戻る",
  periodLabel: "対象期間",
};

export function getI18n(lang: string = "en"): PagesI18n {
  const isJa = lang.toLowerCase() === "ja" || lang.toLowerCase() === "japanese";
  return isJa ? I18N_JA : I18N_EN;
}

// Content Security Policy for the generated pages. Every asset is served by the site itself and
// only ./app.js may run; inline style attributes stay allowed (404 page, empty-state messages).
// This blocks script execution even if injected markup ever reached the rendered summaries.
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

/** Files copied from src/publishing/pages_assets/ into the site. */
const PAGES_ASSETS = ["styles.css", "app.js"] as const;

/**
 * Escapes HTML entities.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Parses a single daily summary markdown file.
 */
/**
 * Parses a single summary or periodic report markdown file.
 */
export function parseDailySummary(filePath: string): PageSummaryItem | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");

    // Extract frontmatter
    let frontmatter: Record<string, unknown> = {};
    let markdownBody = content;

    if (content.startsWith("---")) {
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (match && match[1]) {
        try {
          frontmatter = yaml.parse(match[1]) || {};
        } catch {
          // Fallback simple line-by-line key-value parsing
          frontmatter = {};
          const fmLines = match[1].split(/\r?\n/);
          for (const fml of fmLines) {
            const colonIdx = fml.indexOf(":");
            if (colonIdx > 0 && !fml.startsWith(" ") && !fml.startsWith("-")) {
              const k = fml.slice(0, colonIdx).trim();
              let v = fml.slice(colonIdx + 1).trim();
              if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1);
              }
              if (/^\d+$/.test(v)) {
                frontmatter[k] = parseInt(v, 10);
              } else {
                frontmatter[k] = v;
              }
            }
          }
        }
        markdownBody = content.slice(match[0].length).trim();
      }
    }

    // Determine date from frontmatter, filename, or body
    let date = "";
    if (frontmatter.date && typeof frontmatter.date === "string") {
      date = frontmatter.date.slice(0, 10);
    }
    if (!date) {
      const fileMatch = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/);
      if (fileMatch && fileMatch[1]) {
        date = fileMatch[1];
      }
    }
    if (!date) {
      date = new Date().toISOString().slice(0, 10);
    }

    // Determine reportType: "daily" | "weekly" | "monthly" | "yearly"
    let reportType: ReportType = "daily";
    const rawType = String(frontmatter["type"] || "").toLowerCase();
    const basename = path.basename(filePath).toLowerCase();
    const normPath = filePath.replace(/\\/g, "/").toLowerCase();

    if (
      rawType === "weekly_report" ||
      rawType.includes("weekly") ||
      basename.includes("weekly") ||
      normPath.includes("/weekly/")
    ) {
      reportType = "weekly";
    } else if (
      rawType === "monthly_report" ||
      rawType === "monthly_digest" ||
      rawType.includes("monthly") ||
      basename.includes("monthly") ||
      normPath.includes("/monthly/")
    ) {
      reportType = "monthly";
    } else if (
      rawType === "yearly_report" ||
      rawType.includes("yearly") ||
      basename.includes("yearly") ||
      normPath.includes("/yearly/")
    ) {
      reportType = "yearly";
    } else {
      reportType = "daily";
    }

    // Title & Headline
    const defaultTitle =
      reportType === "weekly"
        ? `Weekly Report ${date}`
        : reportType === "monthly"
          ? `Monthly Digest ${date.slice(0, 7)}`
          : reportType === "yearly"
            ? `Yearly Report ${date.slice(0, 4)}`
            : `Daily Summary ${date}`;

    const title = String(frontmatter["title"] || defaultTitle);
    let topStory = String(frontmatter["top_story"] || "");
    if (!topStory) {
      const h3Match = markdownBody.match(/###\s+(.+)/);
      if (h3Match && h3Match[1]) {
        topStory = h3Match[1].trim();
      } else {
        topStory = title;
      }
    }

    // Determine period identifier (e.g. "2026-W38", "2026-09", "2026", "2026-09-20")
    let period: string = frontmatter.period ? String(frontmatter.period) : "";
    if (!period) {
      if (reportType === "weekly") {
        const weekMatch =
          basename.match(/(\d{4}-w\d{2})/i) || title.match(/(\d{4}-w\d{2})/i) || markdownBody.match(/(\d{4}-w\d{2})/i);
        period = weekMatch && weekMatch[1] ? weekMatch[1].toUpperCase() : date;
      } else if (reportType === "monthly") {
        const monthMatch = basename.match(/(\d{4}-\d{2})/) || title.match(/(\d{4}-\d{2})/);
        period = monthMatch && monthMatch[1] ? monthMatch[1] : date.slice(0, 7);
      } else if (reportType === "yearly") {
        const yearMatch = basename.match(/(\d{4})/) || title.match(/(\d{4})/);
        period = yearMatch && yearMatch[1] ? yearMatch[1] : date.slice(0, 4);
      } else {
        period = date;
      }
    }

    const id = `${reportType}-${period || date}`;

    let sourceUrl: string | undefined = undefined;
    const sourceMatch = markdownBody.match(/\*\*(?:出典|Source)\*\*:\s*(?:\[[^\]]+\]\()?(https?:\/\/[^\s)]+)/);
    if (sourceMatch && sourceMatch[1]) {
      sourceUrl = sourceMatch[1].replace(/\)$/, "");
    }

    const categories: string[] = Array.isArray(frontmatter.categories) ? frontmatter.categories : [];
    const tags: string[] = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    const rawCount = frontmatter.articles_processed ?? frontmatter.article_count ?? frontmatter.total_articles;
    const parsedCount =
      typeof rawCount === "number" ? rawCount : typeof rawCount === "string" ? parseInt(rawCount, 10) : 0;
    const articleCount = Number.isNaN(parsedCount) ? 0 : parsedCount;

    const rawQuality = frontmatter.quality_score;
    const parsedQuality =
      typeof rawQuality === "number" ? rawQuality : typeof rawQuality === "string" ? parseFloat(rawQuality) : null;
    const qualityScore = parsedQuality !== null && !Number.isNaN(parsedQuality) ? parsedQuality : null;
    const language: string | undefined = typeof frontmatter.language === "string" ? frontmatter.language : undefined;

    const contentHtml = markdownToHtml(markdownBody);

    return {
      id,
      date,
      period,
      reportType,
      title,
      topStory,
      categories,
      tags,
      articleCount,
      qualityScore,
      ...(frontmatter.top_purpose ? { topPurpose: String(frontmatter.top_purpose) } : {}),
      ...(language ? { language } : {}),
      contentHtml,
      rawMarkdown: markdownBody,
      ...(sourceUrl ? { sourceUrl } : {}),
    };
  } catch (err) {
    console.warn(`⚠️ Failed to parse summary at ${filePath}: ${errorMessage(err)}`);
    return null;
  }
}

export interface ScannedSummariesResult {
  all: PageSummaryItem[];
  daily: PageSummaryItem[];
  reports: PageSummaryItem[];
}

/**
 * Scans directories for all daily summaries and periodic reports (weekly, monthly, yearly).
 */
export function scanAllSummaries(artifactsDir?: string): ScannedSummariesResult {
  const searchDirs = artifactsDir
    ? [artifactsDir].filter((d) => fs.existsSync(d))
    : [
        PATHS.ARTIFACTS_DAILY.absolute,
        PATHS.ARTIFACTS_WEEKLY.absolute,
        PATHS.ARTIFACTS_MONTHLY.absolute,
        PATHS.ARTIFACTS_YEARLY.absolute,
        path.resolve(process.cwd(), "artifacts/contents/daily"),
        path.resolve(process.cwd(), "artifacts/contents/weekly"),
        path.resolve(process.cwd(), "artifacts/contents/monthly"),
        path.resolve(process.cwd(), "artifacts/contents/yearly"),
        path.resolve(process.cwd(), "artifacts/contents/digital-trend/collection/daily"),
        path.resolve(process.cwd(), "artifacts/contents/digital-trend/collection/weekly"),
        path.resolve(process.cwd(), "artifacts/contents/digital-trend/collection/monthly"),
        path.resolve(process.cwd(), "artifacts/contents/digital-trend/collection/yearly"),
        path.resolve(process.cwd(), "artifacts/contents/digital-trend/collection"),
        path.resolve(process.cwd(), "artifacts"),
      ].filter((d): d is string => typeof d === "string" && fs.existsSync(d));

  const foundFiles = new Set<string>();

  function walk(dir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          walk(fullPath);
        } else if (
          item.isFile() &&
          item.name.endsWith(".md") &&
          (item.name.includes("summary") ||
            item.name.includes("trend") ||
            item.name.includes("report") ||
            item.name.includes("digest") ||
            item.name.includes("weekly") ||
            item.name.includes("monthly") ||
            item.name.includes("yearly"))
        ) {
          foundFiles.add(fullPath);
        }
      }
    } catch {
      // Skip inaccessible directory
    }
  }

  for (const dir of searchDirs) {
    walk(dir);
  }

  const items: PageSummaryItem[] = [];
  for (const file of foundFiles) {
    const parsed = parseDailySummary(file);
    if (parsed) {
      items.push(parsed);
    }
  }

  // Deduplicate by unique key
  const byKey = new Map<string, PageSummaryItem>();
  for (const item of items) {
    const key = item.id || `${item.reportType || "daily"}-${item.period || item.date}`;
    const existing = byKey.get(key);
    if (!existing || item.rawMarkdown.length > existing.rawMarkdown.length) {
      byKey.set(key, item);
    }
  }

  const deduplicated = Array.from(byKey.values());

  const daily = deduplicated
    .filter((i) => i.reportType === "daily" || !i.reportType)
    .sort((a, b) => b.date.localeCompare(a.date));

  const reports = deduplicated
    .filter((i) => i.reportType && i.reportType !== "daily")
    .sort((a, b) => {
      const aKey = a.period || a.date;
      const bKey = b.period || b.date;
      return bKey.localeCompare(aKey);
    });

  const all = [...daily, ...reports];

  return { all, daily, reports };
}

/**
 * Scans directories for daily summary Markdown files (backward compatibility).
 */
export function scanDailySummaries(artifactsDir?: string): PageSummaryItem[] {
  return scanAllSummaries(artifactsDir).daily;
}

/**
 * Builds static site HTML, CSS, JavaScript, and JSON data.
 */
export function generatePagesSite(
  artifactsDir?: string,
  outputDir: string = PATHS.PAGES_OUTPUT.absolute,
  language?: string,
): {
  outputPath: string;
  summaryCount: number;
  latestDate: string | null;
  reportCount: number;
} {
  const siteLang = language || process.env.OUTPUT_LANGUAGE || process.env.SUMMARY_LANGUAGE || "en";
  const i18n = getI18n(siteLang);
  const { all, daily, reports } = scanAllSummaries(artifactsDir);
  const outDir = path.resolve(process.cwd(), outputDir);
  const dataDir = path.join(outDir, "data");

  fs.mkdirSync(dataDir, { recursive: true });

  const jsonPath = path.join(dataDir, "summaries.json");
  fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2), "utf8");

  const reportsJsonPath = path.join(dataDir, "reports.json");
  fs.writeFileSync(reportsJsonPath, JSON.stringify(reports, null, 2), "utf8");

  // Static stylesheet and client script (src/publishing/pages_assets/)
  for (const asset of PAGES_ASSETS) {
    fs.copyFileSync(path.join(PATHS.PAGES_ASSETS, asset), path.join(outDir, asset));
  }

  const latestSummary = daily[0] ?? all[0] ?? null;
  fs.writeFileSync(path.join(outDir, "index.html"), generateHtml(daily, reports, latestSummary, i18n), "utf8");
  fs.writeFileSync(path.join(outDir, "404.html"), generate404Html(i18n), "utf8");
  fs.writeFileSync(
    path.join(outDir, "feed.xml"),
    buildAtomFeed(
      daily.map((d) => ({ date: d.date, title: d.title, topStory: d.topStory, articleCount: d.articleCount })),
      resolveSiteUrl(),
      new Date().toISOString(),
    ),
    "utf8",
  );

  console.log(
    `🌐 GitHub Pages site generated at: ${outDir} (${daily.length} daily summaries, ${reports.length} periodic reports, lang: ${i18n.langCode})`,
  );
  return {
    outputPath: outDir,
    summaryCount: all.length,
    latestDate: latestSummary ? latestSummary.date : null,
    reportCount: reports.length,
  };
}

/**
 * Generates the main HTML page with embedded initial state for instant load.
 */
function generateHtml(
  dailySummaries: PageSummaryItem[],
  periodicReports: PageSummaryItem[],
  initial: PageSummaryItem | null,
  i18n: PagesI18n = I18N_EN,
): string {
  const initialDate = initial ? initial.period || initial.date : "";
  const initialTitle = initial ? initial.title : "No summaries available";
  const initialTopStory = initial ? initial.topStory : i18n.noDataHeadline;
  const initialContent = initial ? initial.contentHtml : i18n.noDataContent;
  const initialCategories = initial ? initial.categories : [];
  const initialTags = initial ? initial.tags : [];
  const initialArticleCount = initial ? initial.articleCount : 0;
  const initialQuality =
    initial?.qualityScore !== null && initial?.qualityScore !== undefined
      ? `${initial.qualityScore.toFixed(0)} pt`
      : "-";

  let initialBadge = i18n.reportBadgeDaily;
  let initialBadgeClass = "badge-daily";
  if (initial?.reportType === "weekly") {
    initialBadge = i18n.reportBadgeWeekly;
    initialBadgeClass = "badge-weekly";
  } else if (initial?.reportType === "monthly") {
    initialBadge = i18n.reportBadgeMonthly;
    initialBadgeClass = "badge-monthly";
  } else if (initial?.reportType === "yearly") {
    initialBadge = i18n.reportBadgeYearly;
    initialBadgeClass = "badge-yearly";
  }

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const initialCalTitle = i18n.monthTitle(currentYear, currentMonth);

  return `<!DOCTYPE html>
<html lang="${i18n.langCode}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(i18n.pageTitle)}</title>
  <meta name="description" content="${escapeHtml(i18n.pageDescription)}">
  <link rel="stylesheet" href="./styles.css">
  <link rel="alternate" type="application/atom+xml" title="Digital Trend Flow" href="./feed.xml">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📡</text></svg>">
</head>
<body data-theme="dark">
  <div class="app-layout">
    <!-- Navigation / Header -->
    <header class="app-header">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-logo">📡</span>
          <div class="brand-text">
            <span class="brand-name">Digital Trend Flow</span>
            <span class="brand-sub">${escapeHtml(i18n.pageDescription.slice(0, 45))}</span>
          </div>
        </div>
        <div class="header-actions">
          <button id="themeToggle" class="btn-icon" aria-label="${escapeHtml(i18n.themeToggleTitle)}" title="${escapeHtml(i18n.themeToggleTitle)}">
            <span class="theme-icon">🌙</span>
          </button>
          <a href="https://github.com/sun-flat-yamada/digital-trend-flow" target="_blank" rel="noopener noreferrer" class="btn-github">
            <svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </header>

    <!-- Main Container -->
    <div class="main-container">
      <!-- Sidebar / Navigation -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-tabs">
          <button class="tab-btn active" data-tab="calendar" id="tabCalendarBtn">
            <span>${escapeHtml(i18n.tabCalendar)}</span>
          </button>
          <button class="tab-btn" data-tab="list" id="tabListBtn">
            <span>${escapeHtml(i18n.tabList)}</span>
            <span class="count-badge" id="listCountBadge">${dailySummaries.length}</span>
          </button>
          <button class="tab-btn" data-tab="reports" id="tabReportsBtn">
            <span>${escapeHtml(i18n.tabReports)}</span>
            <span class="count-badge count-badge-reports" id="reportsCountBadge">${periodicReports.length}</span>
          </button>
        </div>

        <!-- Tab 1: Calendar View -->
        <div class="tab-content active" id="calendarTab">
          <div class="calendar-widget">
            <div class="calendar-header">
              <button id="calPrev" class="cal-nav-btn" aria-label="Previous">◀</button>
              <div id="calTitle" class="calendar-title">${escapeHtml(initialCalTitle)}</div>
              <button id="calNext" class="cal-nav-btn" aria-label="Next">▶</button>
            </div>
            <div class="calendar-weekdays">
              ${i18n.calWeekdays.map((w) => `<span>${escapeHtml(w)}</span>`).join("")}
            </div>
            <div id="calendarGrid" class="calendar-grid">
              <!-- Rendered by app.js -->
            </div>
          </div>
          <div class="calendar-legend">
            <span class="legend-item"><span class="legend-dot has-data"></span>${escapeHtml(i18n.calLegendHasData)}</span>
            <span class="legend-item"><span class="legend-box is-today"></span>${escapeHtml(i18n.calLegendToday)}</span>
            <span class="legend-item"><span class="legend-box selected"></span>${escapeHtml(i18n.calLegendSelected)}</span>
          </div>
        </div>

        <!-- Tab 2: Back Number List View -->
        <div class="tab-content" id="listTab">
          <div class="search-box">
            <input type="text" id="searchInput" placeholder="${escapeHtml(i18n.searchPlaceholder)}" aria-label="${escapeHtml(i18n.searchAriaLabel)}">
            <span class="search-icon">🔍</span>
          </div>
          <div class="backnumber-list" id="backnumberList">
            <!-- Rendered by app.js -->
          </div>
        </div>

        <!-- Tab 3: Periodic Reports View -->
        <div class="tab-content" id="reportsTab">
          <div class="reports-filter-bar">
            <button class="filter-pill active" data-filter="all">${escapeHtml(i18n.filterAll)}</button>
            <button class="filter-pill" data-filter="weekly">${escapeHtml(i18n.filterWeekly)}</button>
            <button class="filter-pill" data-filter="monthly">${escapeHtml(i18n.filterMonthly)}</button>
            <button class="filter-pill" data-filter="yearly">${escapeHtml(i18n.filterYearly)}</button>
          </div>
          <div class="reports-list" id="periodicReportsList">
            <!-- Rendered by app.js -->
          </div>
        </div>
      </aside>

      <!-- Main Content / Detail View -->
      <main class="content-area">
        <!-- Top Headline Card (Today's Headline or Report Summary) -->
        <section class="headline-section" id="headlineCard">
          <div class="headline-badge-bar">
            <span class="badge-headline ${initialBadgeClass}" id="displayHeadlineBadge">${escapeHtml(initialBadge)}</span>
            <span class="badge-date" id="displayDate">${initialDate}</span>
            <span class="badge-stat" id="displayArticleCount">${escapeHtml(i18n.articlesLabel(initialArticleCount))}</span>
            <span class="badge-stat" id="displayQuality">${escapeHtml(i18n.qualityLabel(initialQuality))}</span>
          </div>

          <h1 class="headline-title" id="displayTopStory">${escapeHtml(initialTopStory)}</h1>

          <div class="headline-meta" id="displayMeta">
            <div class="categories-list" id="displayCategories">
              ${initialCategories.map((c) => `<span class="cat-pill">${escapeHtml(c)}</span>`).join("")}
            </div>
            <div class="tags-list" id="displayTags">
              ${initialTags.map((t) => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join("")}
            </div>
          </div>
        </section>

        <!-- Full Summary Content -->
        <article class="summary-body" id="summaryBody">
          <div class="summary-body-header">
            <h2 id="summaryDocumentTitle">${escapeHtml(initialTitle)}</h2>
            <div class="quick-nav-actions">
              <button id="copyLinkBtn" class="btn-action" title="${escapeHtml(i18n.copyLink)}">
                ${escapeHtml(i18n.copyLink)}
              </button>
            </div>
          </div>
          <div class="markdown-render" id="markdownRender">
            ${initialContent}
          </div>
        </article>
      </main>
    </div>

    <!-- Footer -->
    <footer class="app-footer">
      <div class="footer-inner">
        <span>© 2026 Digital Trend Flow · Automated LLM Map-Reduce Intelligence</span>
        <span class="footer-note">Powered by Gemini & GitHub Actions</span>
      </div>
    </footer>
  </div>

  <script id="i18n-data" type="application/json">${clientI18nJson(i18n)}</script>
  <script src="./app.js"></script>
</body>
</html>`;
}

/**
 * Generates 404 page redirecting to index.
 */
function generate404Html(i18n: PagesI18n = I18N_EN): string {
  return `<!DOCTYPE html>
<html lang="${i18n.langCode}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
  <title>${escapeHtml(i18n.notFoundTitle)}</title>
  <meta http-equiv="refresh" content="2;url=./">
  <link rel="stylesheet" href="./styles.css">
</head>
<body data-theme="dark" style="display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center;">
  <div>
    <h1>404 Not Found</h1>
    <p>${escapeHtml(i18n.notFoundDesc)}</p>
    <a href="./" class="btn-action">${escapeHtml(i18n.notFoundBack)}</a>
  </div>
</body>
</html>`;
}

/**
 * The UI strings `app.js` reads from the `i18n-data` block of index.html, as JSON that is safe
 * inside a `<script>` element.
 */
function clientI18nJson(i18n: PagesI18n): string {
  return JSON.stringify({
    langCode: i18n.langCode,
    isJa: i18n.langCode === "ja",
    articlesPrefix: i18n.langCode === "ja" ? "📊 収集記事: " : "📊 Articles: ",
    articlesSuffix: i18n.langCode === "ja" ? "件" : "",
    qualityPrefix: i18n.langCode === "ja" ? "🏆 品質: " : "🏆 Quality: ",
    cardArticlesSuffix: i18n.langCode === "ja" ? " 記事" : " articles",
    copySuccess: i18n.copiedLink,
    copyOriginal: i18n.copyLink,
    summaryTooltip: i18n.summaryAvailableTooltip,
    noResults: i18n.noSearchResults,
    noReportsFound: i18n.noReportsFound,
    reportBadgeDaily: i18n.reportBadgeDaily,
    reportBadgeWeekly: i18n.reportBadgeWeekly,
    reportBadgeMonthly: i18n.reportBadgeMonthly,
    reportBadgeYearly: i18n.reportBadgeYearly,
    periodLabel: i18n.periodLabel,
  }).replace(/</g, "\\u003c");
}
