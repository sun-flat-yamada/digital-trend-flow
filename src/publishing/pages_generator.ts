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

export interface PageSummaryItem {
  date: string; // "YYYY-MM-DD"
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
  cardArticles: (count: number) => string;
  summaryAvailableTooltip: string;
  monthTitle: (year: number, month: number) => string;
  notFoundTitle: string;
  notFoundDesc: string;
  notFoundBack: string;
}

export const I18N_EN: PagesI18n = {
  langCode: "en",
  pageTitle: "Digital Trend Flow — Daily Technology Trend Hub",
  pageDescription: "AI-powered automated daily digital & tech trend intelligence platform. Browse top headlines and back numbers.",
  themeToggleTitle: "Toggle dark/light mode",
  tabCalendar: "📅 Calendar",
  tabList: "📋 Archive List",
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
  cardArticles: (count) => `${count} articles`,
  summaryAvailableTooltip: "Summary available: ",
  monthTitle: (year, month) => {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[month]} ${year}`;
  },
  notFoundTitle: "Page Not Found — Digital Trend Flow",
  notFoundDesc: "Redirecting to home page...",
  notFoundBack: "Back to Home",
};

export const I18N_JA: PagesI18n = {
  langCode: "ja",
  pageTitle: "Digital Trend Flow — Daily Technology Trend Hub",
  pageDescription: "AIを活用した毎日のデジタル・テック動向自動集約プラットフォーム。トップヘッドラインおよびバックナンバー（カレンダー・リスト）を閲覧できます。",
  themeToggleTitle: "ダーク/ライト切替",
  tabCalendar: "📅 カレンダー",
  tabList: "📋 リスト一覧",
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
  cardArticles: (count) => `${count} 記事`,
  summaryAvailableTooltip: "サマリーあり: ",
  monthTitle: (year, month) => `${year}年 ${String(month + 1).padStart(2, "0")}月`,
  notFoundTitle: "ページが見つかりません — Digital Trend Flow",
  notFoundDesc: "トップページへ自動遷移します...",
  notFoundBack: "トップページへ戻る",
};

export function getI18n(lang: string = "en"): PagesI18n {
  const isJa = lang.toLowerCase() === "ja" || lang.toLowerCase() === "japanese";
  return isJa ? I18N_JA : I18N_EN;
}

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
 * Converts Markdown text into clean, accessible HTML.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const htmlParts: string[] = [];
  let inList = false;
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();

    // End blockquote if empty line
    if (inBlockquote && !line.startsWith(">")) {
      htmlParts.push("</blockquote>");
      inBlockquote = false;
    }

    // End list if not list item
    if (inList && !line.startsWith("- ") && !line.startsWith("* ") && line !== "") {
      htmlParts.push("</ul>");
      inList = false;
    }

    if (line === "") {
      continue;
    }

    // Horizontal rule
    if (/^---{1,}$/.test(line)) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      if (inBlockquote) {
        htmlParts.push("</blockquote>");
        inBlockquote = false;
      }
      htmlParts.push("<hr class=\"summary-divider\" />");
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      const text = escapeHtml(line.slice(2));
      htmlParts.push(`<h1 class="summary-h1">${text}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      const text = escapeHtml(line.slice(3));
      htmlParts.push(`<h2 class="summary-h2">${text}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      const text = escapeHtml(line.slice(4));
      htmlParts.push(`<h3 class="summary-h3">${text}</h3>`);
      continue;
    }
    if (line.startsWith("#### ")) {
      const text = escapeHtml(line.slice(5));
      htmlParts.push(`<h4 class="summary-h4">${text}</h4>`);
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const content = formatInline(line.replace(/^>\s?/, ""));
      if (!inBlockquote) {
        htmlParts.push("<blockquote class=\"summary-quote\">");
        inBlockquote = true;
      }
      htmlParts.push(`<p>${content}</p>`);
      continue;
    }

    // List item
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const itemContent = formatInline(line.slice(2));
      if (!inList) {
        htmlParts.push("<ul class=\"summary-list\">");
        inList = true;
      }
      htmlParts.push(`<li>${itemContent}</li>`);
      continue;
    }

    // Source link line (e.g. **出典**: https://... or **Source**: https://...)
    if (line.includes("**出典**:") || line.includes("**Source**:")) {
      const formatted = formatInline(line);
      htmlParts.push(`<div class="article-source">${formatted}</div>`);
      continue;
    }

    // Foldable details block (e.g. <details class="pipeline-metrics">, <summary>...</summary>, </details>)
    if (line.startsWith("<details") || line.startsWith("</details>") || line.startsWith("<summary")) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      if (inBlockquote) {
        htmlParts.push("</blockquote>");
        inBlockquote = false;
      }

      if (line.startsWith("<details")) {
        htmlParts.push(line);
        continue;
      }
      if (line.startsWith("</details>")) {
        htmlParts.push("</details>");
        continue;
      }
      if (line.startsWith("<summary")) {
        const summaryMatch = line.match(/^<summary(?:\s+[^>]*)?>([\s\S]*?)<\/summary>$/);
        if (summaryMatch && summaryMatch[1]) {
          htmlParts.push(`<summary>${formatInline(summaryMatch[1])}</summary>`);
        } else {
          htmlParts.push(line);
        }
        continue;
      }
    }

    // Regular paragraph
    htmlParts.push(`<p class="summary-p">${formatInline(line)}</p>`);
  }

  if (inList) htmlParts.push("</ul>");
  if (inBlockquote) htmlParts.push("</blockquote>");

  return htmlParts.join("\n");
}

/**
 * Formats inline markdown elements (bold, italic, code, links).
 */
function formatInline(text: string): string {
  let res = escapeHtml(text);

  // Markdown links [text](url)
  res = res.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="link">$1</a>');

  // Plain URLs not wrapped in <a>
  res = res.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer" class="link">$2</a>');

  // Bold **text**
  res = res.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic *text*
  res = res.replace(/(^|[^*])\*([^*]+)\*(?=[^*]|$)/g, "$1<em>$2</em>");

  // Inline code `code`
  res = res.replace(/`([^`]+)`/g, "<code>$1</code>");

  return res;
}

/**
 * Parses a single daily summary markdown file.
 */
export function parseDailySummary(filePath: string): PageSummaryItem | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");

    // Extract frontmatter
    let frontmatter: Record<string, any> = {};
    let markdownBody = content;

    if (content.startsWith("---")) {
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (match && match[1]) {
        try {
          frontmatter = yaml.parse(match[1]) || {};
        } catch {
          frontmatter = {};
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

    // Title & Headline
    const title = frontmatter.title || `Daily Summary ${date}`;
    let topStory = frontmatter.top_story || "";
    if (!topStory) {
      const h3Match = markdownBody.match(/###\s+(.+)/);
      if (h3Match && h3Match[1]) {
        topStory = h3Match[1].trim();
      } else {
        topStory = title;
      }
    }

    let sourceUrl: string | undefined = undefined;
    const sourceMatch = markdownBody.match(/\*\*(?:出典|Source)\*\*:\s*(?:\[[^\]]+\]\()?(https?:\/\/[^\s)]+)/);
    if (sourceMatch && sourceMatch[1]) {
      sourceUrl = sourceMatch[1].replace(/\)$/, "");
    }

    const categories: string[] = Array.isArray(frontmatter.categories)
      ? frontmatter.categories
      : [];
    const tags: string[] = Array.isArray(frontmatter.tags)
      ? frontmatter.tags
      : [];
    const articleCount = typeof frontmatter.articles_processed === "number"
      ? frontmatter.articles_processed
      : (typeof frontmatter.article_count === "number" ? frontmatter.article_count : 0);
    const qualityScore = typeof frontmatter.quality_score === "number"
      ? frontmatter.quality_score
      : null;
    const language: string | undefined =
      typeof frontmatter.language === "string" ? frontmatter.language : undefined;

    const contentHtml = markdownToHtml(markdownBody);

    return {
      date,
      title,
      topStory,
      categories,
      tags,
      articleCount,
      qualityScore,
      ...(frontmatter.top_purpose ? { topPurpose: frontmatter.top_purpose } : {}),
      ...(language ? { language } : {}),
      contentHtml,
      rawMarkdown: markdownBody,
      ...(sourceUrl ? { sourceUrl } : {}),
    };
  } catch (err: any) {
    console.warn(`⚠️ Failed to parse summary at ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Scans directories for daily summary Markdown files.
 */
export function scanDailySummaries(artifactsDir?: string): PageSummaryItem[] {
  const searchDirs = artifactsDir
    ? [artifactsDir].filter((d) => fs.existsSync(d))
    : [
        PATHS.ARTIFACTS_DAILY.absolute,
        path.resolve(process.cwd(), "artifacts/contents/daily"),
        path.resolve(process.cwd(), "artifacts/contents/digital-trend/collection/daily"),
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
        } else if (item.isFile() && item.name.endsWith(".md") && (item.name.includes("summary") || item.name.includes("trend"))) {
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

  const byDate = new Map<string, PageSummaryItem>();
  for (const item of items) {
    const existing = byDate.get(item.date);
    if (!existing || item.rawMarkdown.length > existing.rawMarkdown.length) {
      byDate.set(item.date, item);
    }
  }

  return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Builds static site HTML, CSS, JavaScript, and JSON data.
 */
export function generatePagesSite(
  artifactsDir?: string,
  outputDir: string = PATHS.PAGES_OUTPUT.absolute,
  language?: string
): { outputPath: string; summaryCount: number; latestDate: string | null } {
  const siteLang = language || process.env.OUTPUT_LANGUAGE || process.env.SUMMARY_LANGUAGE || "en";
  const i18n = getI18n(siteLang);
  const summaries = scanDailySummaries(artifactsDir);
  const outDir = path.resolve(process.cwd(), outputDir);
  const dataDir = path.join(outDir, "data");

  fs.mkdirSync(dataDir, { recursive: true });

  const jsonPath = path.join(dataDir, "summaries.json");
  fs.writeFileSync(jsonPath, JSON.stringify(summaries, null, 2), "utf8");

  fs.writeFileSync(path.join(outDir, "styles.css"), generateCss(), "utf8");
  fs.writeFileSync(path.join(outDir, "app.js"), generateJs(i18n), "utf8");

  const latestSummary = summaries[0] ?? null;
  fs.writeFileSync(path.join(outDir, "index.html"), generateHtml(summaries, latestSummary, i18n), "utf8");
  fs.writeFileSync(path.join(outDir, "404.html"), generate404Html(i18n), "utf8");

  console.log(`🌐 GitHub Pages site generated at: ${outDir} (${summaries.length} summaries, lang: ${i18n.langCode})`);
  return {
    outputPath: outDir,
    summaryCount: summaries.length,
    latestDate: latestSummary ? latestSummary.date : null,
  };
}

/**
 * Generates the main HTML page with embedded initial state for instant load.
 */
function generateHtml(
  summaries: PageSummaryItem[],
  initial: PageSummaryItem | null,
  i18n: PagesI18n = I18N_EN
): string {
  const initialDate = initial ? initial.date : "";
  const initialTitle = initial ? initial.title : "No summaries available";
  const initialTopStory = initial ? initial.topStory : i18n.noDataHeadline;
  const initialContent = initial ? initial.contentHtml : i18n.noDataContent;
  const initialCategories = initial ? initial.categories : [];
  const initialTags = initial ? initial.tags : [];
  const initialArticleCount = initial ? initial.articleCount : 0;
  const initialQuality = initial?.qualityScore !== null && initial?.qualityScore !== undefined
    ? `${initial.qualityScore.toFixed(0)} pt`
    : "-";

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const initialCalTitle = i18n.monthTitle(currentYear, currentMonth);

  return `<!DOCTYPE html>
<html lang="${i18n.langCode}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(i18n.pageTitle)}</title>
  <meta name="description" content="${escapeHtml(i18n.pageDescription)}">
  <link rel="stylesheet" href="./styles.css">
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
      <!-- Sidebar / Back Number Navigation -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-tabs">
          <button class="tab-btn active" data-tab="calendar" id="tabCalendarBtn">
            <span>${escapeHtml(i18n.tabCalendar)}</span>
          </button>
          <button class="tab-btn" data-tab="list" id="tabListBtn">
            <span>${escapeHtml(i18n.tabList)}</span>
            <span class="count-badge" id="listCountBadge">${summaries.length}</span>
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
      </aside>

      <!-- Main Content / Detail View -->
      <main class="content-area">
        <!-- Top Headline Card (Today's Headline) -->
        <section class="headline-section" id="headlineCard">
          <div class="headline-badge-bar">
            <span class="badge-headline">${escapeHtml(i18n.headlineBadge)}</span>
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
 * Generates modern, clean CSS styling.
 */
function generateCss(): string {
  return `/* Digital Trend Flow — Modern Theme */
:root {
  --bg-base: #0f172a;
  --bg-surface: #1e293b;
  --bg-card: #1e293b;
  --bg-highlight: #334155;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --border: #334155;
  --border-focus: #38bdf8;
  --accent-primary: #38bdf8;
  --accent-secondary: #818cf8;
  --accent-emerald: #34d399;
  --accent-amber: #fbbf24;
  --badge-bg: rgba(56, 189, 248, 0.12);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

[data-theme="light"] {
  --bg-base: #f8fafc;
  --bg-surface: #ffffff;
  --bg-card: #ffffff;
  --bg-highlight: #e2e8f0;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --border: #e2e8f0;
  --border-focus: #0284c7;
  --accent-primary: #0284c7;
  --accent-secondary: #6366f1;
  --accent-emerald: #059669;
  --accent-amber: #d97706;
  --badge-bg: rgba(2, 132, 199, 0.08);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.08);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-sans);
  line-height: 1.6;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.app-header {
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 50;
  box-shadow: var(--shadow-sm);
}

.header-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0.75rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-logo {
  font-size: 1.75rem;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.brand-sub {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1rem;
}

.btn-icon:hover {
  background: var(--bg-highlight);
}

.btn-github {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  background: var(--bg-highlight);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-github:hover {
  border-color: var(--accent-primary);
}

/* Layout */
.main-container {
  max-width: 1400px;
  margin: 1.5rem auto;
  padding: 0 1.5rem;
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 1.5rem;
  flex: 1;
  width: 100%;
}

@media (max-width: 960px) {
  .main-container {
    grid-template-columns: 1fr;
    margin: 1rem auto;
    padding: 0 1rem;
  }
}

/* Sidebar */
.sidebar {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1rem;
  height: fit-content;
  box-shadow: var(--shadow-sm);
}

.sidebar-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.5rem;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: var(--bg-highlight);
  color: var(--accent-primary);
}

.count-badge {
  background: var(--accent-primary);
  color: #0f172a;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 9999px;
}

.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}

/* Calendar */
.calendar-widget {
  margin-bottom: 1rem;
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.calendar-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
}

.cal-nav-btn {
  background: var(--bg-highlight);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s ease;
}

.cal-nav-btn:hover {
  background: var(--accent-primary);
  color: #0f172a;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.cal-cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  color: var(--text-muted);
  cursor: default;
  position: relative;
  transition: all 0.2s ease;
  border: 2px solid transparent;
}

.cal-cell.empty {
  visibility: hidden;
}

.cal-cell.has-data {
  color: var(--text-primary);
  font-weight: 600;
  cursor: pointer;
  background: rgba(56, 189, 248, 0.08);
  border-color: rgba(56, 189, 248, 0.2);
}

.cal-cell.has-data:hover {
  background: rgba(56, 189, 248, 0.22);
  border-color: var(--accent-primary);
}

.cal-cell.is-today {
  border: 2px solid var(--accent-amber) !important;
}

.cal-cell.selected {
  background: var(--accent-primary) !important;
  color: #0f172a !important;
  font-weight: 700;
  border-color: var(--accent-primary) !important;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.6);
}

.cal-cell.is-today.selected {
  background: var(--accent-primary) !important;
  color: #0f172a !important;
  border: 2px solid var(--accent-amber) !important;
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.6), 0 0 4px rgba(56, 189, 248, 0.4);
}

.calendar-legend {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  justify-content: center;
  align-items: center;
  margin-top: 0.6rem;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.legend-dot.has-data {
  background: var(--accent-primary);
}

.legend-box {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
  box-sizing: border-box;
}

.legend-box.is-today {
  border: 2px solid var(--accent-amber);
  background: transparent;
}

.legend-box.selected {
  background: var(--accent-primary);
  border: 1px solid var(--accent-primary);
  box-shadow: 0 0 4px rgba(56, 189, 248, 0.5);
}

/* Back Number List */
.search-box {
  position: relative;
  margin-bottom: 0.75rem;
}

.search-box input {
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 2rem;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s ease;
}

.search-box input:focus {
  border-color: var(--border-focus);
}

.search-icon {
  position: absolute;
  left: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.8rem;
  color: var(--text-muted);
}

.backnumber-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}

.backnumber-card {
  padding: 0.75rem;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.backnumber-card:hover {
  border-color: var(--accent-primary);
  transform: translateY(-1px);
}

.backnumber-card.active {
  border-color: var(--accent-primary);
  background: rgba(56, 189, 248, 0.08);
}

.card-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.3rem;
}

.card-date {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--accent-primary);
}

.card-count {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.card-title {
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Content Area */
.content-area {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Headline Section (当日の Head line) */
.headline-section {
  background: linear-gradient(135deg, var(--bg-surface) 0%, rgba(30, 41, 59, 0.8) 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}

.headline-section::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: linear-gradient(180deg, var(--accent-primary), var(--accent-secondary));
}

.headline-badge-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.badge-headline {
  background: linear-gradient(90deg, #38bdf8, #818cf8);
  color: #0f172a;
  font-size: 0.75rem;
  font-weight: 800;
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-sm);
  letter-spacing: 0.05em;
}

.badge-date {
  background: var(--bg-highlight);
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-sm);
}

.badge-stat {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: var(--bg-highlight);
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-sm);
}

.headline-title {
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.4;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

.headline-meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.categories-list, .tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.cat-pill {
  background: rgba(56, 189, 248, 0.15);
  color: var(--accent-primary);
  border: 1px solid rgba(56, 189, 248, 0.3);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius-sm);
}

.tag-pill {
  background: var(--bg-highlight);
  color: var(--text-muted);
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius-sm);
}

/* Summary Body */
.summary-body {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 2rem;
  box-shadow: var(--shadow-sm);
}

.summary-body-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
}

.summary-body-header h2 {
  font-size: 1.3rem;
  font-weight: 700;
}

.btn-action {
  background: var(--bg-highlight);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.8rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action:hover {
  background: var(--accent-primary);
  color: #0f172a;
}

/* Markdown Rendering */
.markdown-render {
  line-height: 1.75;
  color: var(--text-primary);
}

.markdown-render .summary-h1 {
  display: none;
}

.markdown-render .summary-h2 {
  font-size: 1.3rem;
  font-weight: 700;
  margin: 1.75rem 0 1rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--border);
  color: var(--accent-primary);
}

.markdown-render .summary-h3 {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 1.25rem 0 0.5rem;
  color: var(--text-primary);
}

.markdown-render .summary-h4 {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 1rem 0 0.4rem;
}

.markdown-render .summary-p {
  margin-bottom: 0.75rem;
  color: var(--text-secondary);
}

.markdown-render .summary-quote {
  border-left: 3px solid var(--accent-primary);
  background: rgba(56, 189, 248, 0.05);
  padding: 0.75rem 1rem;
  margin: 1rem 0;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.markdown-render .summary-list {
  padding-left: 1.5rem;
  margin-bottom: 1rem;
  color: var(--text-secondary);
}

.markdown-render .summary-list li {
  margin-bottom: 0.4rem;
}

.markdown-render .article-source {
  font-size: 0.82rem;
  color: var(--text-muted);
  background: var(--bg-base);
  padding: 0.4rem 0.75rem;
  border-radius: var(--radius-sm);
  margin: 0.5rem 0 1rem;
  border: 1px solid var(--border);
}

.markdown-render .summary-divider {
  border: 0;
  height: 1px;
  background: var(--border);
  margin: 2rem 0;
}

.markdown-render a.link {
  color: var(--accent-primary);
  text-decoration: none;
  word-break: break-all;
}

.markdown-render a.link:hover {
  text-decoration: underline;
}

.markdown-render code {
  background: var(--bg-highlight);
  padding: 0.15rem 0.35rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.85em;
}

/* Execution Metrics Accordion */
details.pipeline-metrics {
  margin: 2rem 0 1rem;
  padding: 0.85rem 1.25rem;
  background: var(--bg-highlight);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: background 0.2s ease, border-color 0.2s ease;
}

details.pipeline-metrics[open] {
  background: var(--bg-surface);
  border-color: var(--accent-primary);
  box-shadow: var(--shadow-sm);
}

details.pipeline-metrics summary {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent-primary);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  user-select: none;
}

details.pipeline-metrics summary::-webkit-details-marker {
  display: none;
}

details.pipeline-metrics summary::before {
  content: "▶";
  font-size: 0.75rem;
  transition: transform 0.2s ease;
  color: var(--text-muted);
}

details.pipeline-metrics[open] summary::before {
  transform: rotate(90deg);
  color: var(--accent-primary);
}

details.pipeline-metrics summary:hover {
  color: var(--text-primary);
}

details.pipeline-metrics .summary-list {
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
  padding-left: 1.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

details.pipeline-metrics .summary-list li {
  margin-bottom: 0.35rem;
}

/* Footer */
.app-footer {
  margin-top: auto;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
  padding: 1.25rem 0;
}

.footer-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-muted);
  flex-wrap: wrap;
  gap: 0.5rem;
}
`;
}

/**
 * Generates client-side interactivity JavaScript.
 */
function generateJs(i18n: PagesI18n = I18N_EN): string {
  const i18nConfig = JSON.stringify({
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
  });

  return `(function () {
  const I18N = ${i18nConfig};
  let allSummaries = [];
  let currentSummary = null;
  let currentCalendarYear = new Date().getFullYear();
  let currentCalendarMonth = new Date().getMonth();

  async function init() {
    try {
      const res = await fetch('./data/summaries.json');
      if (res.ok) {
        allSummaries = await res.json();
      }
    } catch (e) {
      console.warn('Failed to load external summaries.json:', e);
    }

    setupTheme();
    setupTabs();
    setupSearch();
    setupRouting();

    const hashDate = window.location.hash.replace(/^#/, '');
    const found = allSummaries.find(s => s.date === hashDate);
    if (found) {
      selectDate(found.date);
    } else if (allSummaries.length > 0) {
      selectDate(allSummaries[0].date);
    }

    renderCalendar();
    renderBacknumberList();

    const copyBtn = document.getElementById('copyLinkBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (!currentSummary) return;
        const url = window.location.origin + window.location.pathname + '#' + currentSummary.date;
        navigator.clipboard.writeText(url).then(() => {
          copyBtn.textContent = '✅ ' + I18N.copySuccess;
          setTimeout(() => { copyBtn.textContent = I18N.copyOriginal; }, 2000);
        });
      });
    }

    document.getElementById('calPrev')?.addEventListener('click', () => {
      currentCalendarMonth--;
      if (currentCalendarMonth < 0) {
        currentCalendarMonth = 11;
        currentCalendarYear--;
      }
      renderCalendar();
    });

    document.getElementById('calNext')?.addEventListener('click', () => {
      currentCalendarMonth++;
      if (currentCalendarMonth > 11) {
        currentCalendarMonth = 0;
        currentCalendarYear++;
      }
      renderCalendar();
    });
  }

  function setupRouting() {
    window.addEventListener('hashchange', () => {
      const hashDate = window.location.hash.replace(/^#/, '');
      if (hashDate && (!currentSummary || currentSummary.date !== hashDate)) {
        selectDate(hashDate);
      }
    });
  }

  function selectDate(dateStr) {
    const item = allSummaries.find(s => s.date === dateStr);
    if (!item) return;

    currentSummary = item;
    window.location.hash = dateStr;

    const displayDate = document.getElementById('displayDate');
    if (displayDate) displayDate.textContent = item.date;

    const displayTopStory = document.getElementById('displayTopStory');
    if (displayTopStory) displayTopStory.textContent = item.topStory;

    const displayCount = document.getElementById('displayArticleCount');
    if (displayCount) displayCount.textContent = I18N.articlesPrefix + item.articleCount + I18N.articlesSuffix;

    const displayQuality = document.getElementById('displayQuality');
    if (displayQuality) {
      displayQuality.textContent = I18N.qualityPrefix + (item.qualityScore !== null ? item.qualityScore.toFixed(0) + ' pt' : '-');
    }

    const catContainer = document.getElementById('displayCategories');
    if (catContainer) {
      catContainer.innerHTML = item.categories.map(c => '<span class="cat-pill">' + escapeHtml(c) + '</span>').join('');
    }

    const tagsContainer = document.getElementById('displayTags');
    if (tagsContainer) {
      tagsContainer.innerHTML = item.tags.map(t => '<span class="tag-pill">#' + escapeHtml(t) + '</span>').join('');
    }

    const docTitle = document.getElementById('summaryDocumentTitle');
    if (docTitle) docTitle.textContent = item.title;

    const renderArea = document.getElementById('markdownRender');
    if (renderArea) renderArea.innerHTML = item.contentHtml;

    const [y, m] = item.date.split('-').map(Number);
    if (y && m) {
      currentCalendarYear = y;
      currentCalendarMonth = m - 1;
    }

    renderCalendar();
    renderBacknumberList();
  }

  function renderCalendar() {
    const calTitle = document.getElementById('calTitle');
    if (calTitle) {
      if (I18N.isJa) {
        calTitle.textContent = currentCalendarYear + '年 ' + String(currentCalendarMonth + 1).padStart(2, '0') + '月';
      } else {
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        calTitle.textContent = (monthNames[currentCalendarMonth] || '') + ' ' + currentCalendarYear;
      }
    }

    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
    const totalDays = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    const now = new Date();
    const todayStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    for (let i = 0; i < firstDay; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell empty';
      grid.appendChild(cell);
    }

    for (let day = 1; day <= totalDays; day++) {
      const dayStr = currentCalendarYear + '-' +
        String(currentCalendarMonth + 1).padStart(2, '0') + '-' +
        String(day).padStart(2, '0');

      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      cell.textContent = String(day);

      const hasSummary = allSummaries.some(s => s.date === dayStr);
      if (hasSummary) {
        cell.classList.add('has-data');
        cell.title = I18N.summaryTooltip + dayStr;
        cell.addEventListener('click', () => selectDate(dayStr));
      }

      if (currentSummary && currentSummary.date === dayStr) {
        cell.classList.add('selected');
        cell.setAttribute('aria-selected', 'true');
      }

      if (dayStr === todayStr) {
        cell.classList.add('is-today');
        cell.setAttribute('aria-current', 'date');
      }

      grid.appendChild(cell);
    }
  }

  function renderBacknumberList(filterText = '') {
    const listContainer = document.getElementById('backnumberList');
    if (!listContainer) return;

    const filtered = allSummaries.filter(item => {
      if (!filterText) return true;
      const q = filterText.toLowerCase();
      return item.title.toLowerCase().includes(q) ||
        item.topStory.toLowerCase().includes(q) ||
        item.date.includes(q) ||
        item.tags.some(t => t.toLowerCase().includes(q)) ||
        item.categories.some(c => c.toLowerCase().includes(q));
    });

    listContainer.innerHTML = '';

    if (filtered.length === 0) {
      listContainer.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); padding:1rem; text-align:center;">' + I18N.noResults + '</p>';
      return;
    }

    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = 'backnumber-card' + (currentSummary && currentSummary.date === item.date ? ' active' : '');
      card.innerHTML = \`
        <div class="card-header-bar">
          <span class="card-date">\${item.date}</span>
          <span class="card-count">\${item.articleCount}\${I18N.cardArticlesSuffix}</span>
        </div>
        <div class="card-title">\${escapeHtml(item.topStory || item.title)}</div>
      \`;
      card.addEventListener('click', () => selectDate(item.date));
      listContainer.appendChild(card);
    });
  }

  function setupTabs() {
    const calTabBtn = document.getElementById('tabCalendarBtn');
    const listTabBtn = document.getElementById('tabListBtn');
    const calTab = document.getElementById('calendarTab');
    const listTab = document.getElementById('listTab');

    calTabBtn?.addEventListener('click', () => {
      calTabBtn.classList.add('active');
      listTabBtn?.classList.remove('active');
      calTab?.classList.add('active');
      listTab?.classList.remove('active');
    });

    listTabBtn?.addEventListener('click', () => {
      listTabBtn.classList.add('active');
      calTabBtn?.classList.remove('active');
      listTab?.classList.add('active');
      calTab?.classList.remove('active');
    });
  }

  function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', (e) => {
      renderBacknumberList(e.target.value.trim());
    });
  }

  function setupTheme() {
    const toggleBtn = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('dtf_theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    toggleBtn?.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      document.body.setAttribute('data-theme', next);
      localStorage.setItem('dtf_theme', next);
      updateThemeIcon(next);
    });
  }

  function updateThemeIcon(theme) {
    const icon = document.querySelector('.theme-icon');
    if (icon) {
      icon.textContent = theme === 'light' ? '☀️' : '🌙';
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;
}
