(function () {
  // UI strings of the site language, written into index.html by pages_generator.ts
  const I18N = JSON.parse(document.getElementById("i18n-data").textContent);
  let allItems = [];
  let dailySummaries = [];
  let periodicReports = [];
  let currentSummary = null;
  let currentReportFilter = "all";
  let currentCalendarYear = new Date().getFullYear();
  let currentCalendarMonth = new Date().getMonth();

  async function init() {
    try {
      const res = await fetch("./data/summaries.json");
      if (res.ok) {
        allItems = await res.json();
        dailySummaries = allItems.filter((s) => !s.reportType || s.reportType === "daily");
        periodicReports = allItems.filter((s) => s.reportType && s.reportType !== "daily");
      }
    } catch (e) {
      console.warn("Failed to load external summaries.json:", e);
    }

    setupTheme();
    setupTabs();
    setupSearch();
    setupReportsFilter();
    setupRouting();

    handleHashOrInitialSelect();

    renderCalendar();
    renderBacknumberList();
    renderPeriodicReportsList();

    const copyBtn = document.getElementById("copyLinkBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        if (!currentSummary) return;
        const targetHash =
          currentSummary.reportType === "daily" || !currentSummary.reportType
            ? currentSummary.date
            : currentSummary.id || currentSummary.period || currentSummary.date;
        const url = window.location.origin + window.location.pathname + "#" + targetHash;
        navigator.clipboard.writeText(url).then(() => {
          copyBtn.textContent = "✅ " + I18N.copySuccess;
          setTimeout(() => {
            copyBtn.textContent = I18N.copyOriginal;
          }, 2000);
        });
      });
    }

    document.getElementById("calPrev")?.addEventListener("click", () => {
      currentCalendarMonth--;
      if (currentCalendarMonth < 0) {
        currentCalendarMonth = 11;
        currentCalendarYear--;
      }
      renderCalendar();
    });

    document.getElementById("calNext")?.addEventListener("click", () => {
      currentCalendarMonth++;
      if (currentCalendarMonth > 11) {
        currentCalendarMonth = 0;
        currentCalendarYear++;
      }
      renderCalendar();
    });
  }

  function findItem(key) {
    if (!key) return null;
    const cleanKey = decodeURIComponent(key)
      .replace(/^#/, "")
      .replace(/^report\//, "")
      .replace(/^report:/, "");
    return allItems.find(
      (s) =>
        (s.id && s.id.toLowerCase() === cleanKey.toLowerCase()) ||
        s.date === cleanKey ||
        (s.period && s.period.toLowerCase() === cleanKey.toLowerCase()) ||
        ((s.reportType || "") + "-" + (s.period || "")).toLowerCase() === cleanKey.toLowerCase(),
    );
  }

  function handleHashOrInitialSelect() {
    const hash = window.location.hash.replace(/^#/, "");
    const found = findItem(hash);
    if (found) {
      selectItem(found);
      if (found.reportType && found.reportType !== "daily") {
        const reportsTabBtn = document.getElementById("tabReportsBtn");
        const reportsTab = document.getElementById("reportsTab");
        const calTabBtn = document.getElementById("tabCalendarBtn");
        const listTabBtn = document.getElementById("tabListBtn");
        const calTab = document.getElementById("calendarTab");
        const listTab = document.getElementById("listTab");
        [calTabBtn, listTabBtn].forEach((b) => b?.classList.remove("active"));
        [calTab, listTab].forEach((c) => c?.classList.remove("active"));
        reportsTabBtn?.classList.add("active");
        reportsTab?.classList.add("active");
      }
    } else if (dailySummaries.length > 0) {
      selectItem(dailySummaries[0]);
    } else if (allItems.length > 0) {
      selectItem(allItems[0]);
    }
  }

  function setupRouting() {
    window.addEventListener("hashchange", () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (
        hash &&
        (!currentSummary ||
          (currentSummary.id !== hash && currentSummary.date !== hash && currentSummary.period !== hash))
      ) {
        const found = findItem(hash);
        if (found) selectItem(found);
      }
    });
  }

  function selectItem(itemOrKey) {
    const item = typeof itemOrKey === "string" ? findItem(itemOrKey) : itemOrKey;
    if (!item) return;

    currentSummary = item;
    const targetHash =
      item.reportType === "daily" || !item.reportType ? item.date : item.id || item.period || item.date;
    window.location.hash = targetHash;

    const displayBadge = document.getElementById("displayHeadlineBadge");
    if (displayBadge) {
      let badgeText = I18N.reportBadgeDaily;
      let badgeClass = "badge-daily";
      if (item.reportType === "weekly") {
        badgeText = I18N.reportBadgeWeekly;
        badgeClass = "badge-weekly";
      } else if (item.reportType === "monthly") {
        badgeText = I18N.reportBadgeMonthly;
        badgeClass = "badge-monthly";
      } else if (item.reportType === "yearly") {
        badgeText = I18N.reportBadgeYearly;
        badgeClass = "badge-yearly";
      }
      displayBadge.textContent = badgeText;
      displayBadge.className = "badge-headline " + badgeClass;
    }

    const displayDate = document.getElementById("displayDate");
    if (displayDate) displayDate.textContent = item.period || item.date;

    const displayTopStory = document.getElementById("displayTopStory");
    if (displayTopStory) displayTopStory.textContent = item.topStory;

    const displayCount = document.getElementById("displayArticleCount");
    if (displayCount) displayCount.textContent = I18N.articlesPrefix + item.articleCount + I18N.articlesSuffix;

    const displayQuality = document.getElementById("displayQuality");
    if (displayQuality) {
      displayQuality.textContent =
        I18N.qualityPrefix + (item.qualityScore !== null ? item.qualityScore.toFixed(0) + " pt" : "-");
    }

    const catContainer = document.getElementById("displayCategories");
    if (catContainer) {
      catContainer.innerHTML = item.categories
        .map((c) => '<span class="cat-pill">' + escapeHtml(c) + "</span>")
        .join("");
    }

    const tagsContainer = document.getElementById("displayTags");
    if (tagsContainer) {
      tagsContainer.innerHTML = item.tags.map((t) => '<span class="tag-pill">#' + escapeHtml(t) + "</span>").join("");
    }

    const docTitle = document.getElementById("summaryDocumentTitle");
    if (docTitle) docTitle.textContent = item.title;

    const renderArea = document.getElementById("markdownRender");
    if (renderArea) renderArea.innerHTML = item.contentHtml;

    if (item.date) {
      const [y, m] = item.date.split("-").map(Number);
      if (y && m) {
        currentCalendarYear = y;
        currentCalendarMonth = m - 1;
      }
    }

    renderCalendar();
    renderBacknumberList();
    renderPeriodicReportsList();
  }

  function renderCalendar() {
    const calTitle = document.getElementById("calTitle");
    if (calTitle) {
      if (I18N.isJa) {
        calTitle.textContent = currentCalendarYear + "年 " + String(currentCalendarMonth + 1).padStart(2, "0") + "月";
      } else {
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
        calTitle.textContent = (monthNames[currentCalendarMonth] || "") + " " + currentCalendarYear;
      }
    }

    const grid = document.getElementById("calendarGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
    const totalDays = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    const now = new Date();
    const todayStr =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");

    for (let i = 0; i < firstDay; i++) {
      const cell = document.createElement("div");
      cell.className = "cal-cell empty";
      grid.appendChild(cell);
    }

    for (let day = 1; day <= totalDays; day++) {
      const dayStr =
        currentCalendarYear +
        "-" +
        String(currentCalendarMonth + 1).padStart(2, "0") +
        "-" +
        String(day).padStart(2, "0");

      const cell = document.createElement("div");
      cell.className = "cal-cell";
      cell.textContent = String(day);

      const hasSummary = dailySummaries.some((s) => s.date === dayStr);
      if (hasSummary) {
        cell.classList.add("has-data");
        cell.title = I18N.summaryTooltip + dayStr;
        cell.addEventListener("click", () => selectItem(dayStr));
      }

      if (
        currentSummary &&
        currentSummary.date === dayStr &&
        (!currentSummary.reportType || currentSummary.reportType === "daily")
      ) {
        cell.classList.add("selected");
        cell.setAttribute("aria-selected", "true");
      }

      if (dayStr === todayStr) {
        cell.classList.add("is-today");
        cell.setAttribute("aria-current", "date");
      }

      grid.appendChild(cell);
    }
  }

  function renderBacknumberList(filterText = "") {
    const listContainer = document.getElementById("backnumberList");
    if (!listContainer) return;

    const filtered = dailySummaries.filter((item) => {
      if (!filterText) return true;
      const q = filterText.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.topStory.toLowerCase().includes(q) ||
        item.date.includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.categories.some((c) => c.toLowerCase().includes(q))
      );
    });

    listContainer.innerHTML = "";

    if (filtered.length === 0) {
      listContainer.innerHTML =
        '<p style="font-size:0.8rem; color:var(--text-muted); padding:1rem; text-align:center;">' +
        I18N.noResults +
        "</p>";
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement("div");
      const isSelected =
        currentSummary &&
        currentSummary.date === item.date &&
        (!currentSummary.reportType || currentSummary.reportType === "daily");
      card.className = "backnumber-card" + (isSelected ? " active" : "");
      card.innerHTML = `
        <div class="card-header-bar">
          <span class="card-date">${item.date}</span>
          <span class="card-count">${item.articleCount}${I18N.cardArticlesSuffix}</span>
        </div>
        <div class="card-title">${escapeHtml(item.topStory || item.title)}</div>
      `;
      card.addEventListener("click", () => selectItem(item));
      listContainer.appendChild(card);
    });
  }

  function renderPeriodicReportsList() {
    const listContainer = document.getElementById("periodicReportsList");
    if (!listContainer) return;

    const filtered = periodicReports.filter((item) => {
      if (currentReportFilter === "all") return true;
      return item.reportType === currentReportFilter;
    });

    listContainer.innerHTML = "";

    if (filtered.length === 0) {
      listContainer.innerHTML =
        '<p style="font-size:0.8rem; color:var(--text-muted); padding:1rem; text-align:center;">' +
        I18N.noReportsFound +
        "</p>";
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement("div");
      const isSelected =
        currentSummary &&
        (currentSummary.id === item.id ||
          (currentSummary.period === item.period && currentSummary.reportType === item.reportType));
      card.className = "report-card" + (isSelected ? " active" : "");
      const typeBadgeClass = "report-badge " + (item.reportType || "weekly");
      const typeBadgeLabel = (item.reportType || "weekly").toUpperCase();
      const periodDisplay = item.period || item.date;

      card.innerHTML = `
        <div class="card-header-bar">
          <span class="${typeBadgeClass}">${typeBadgeLabel}</span>
          <span class="card-date">${escapeHtml(periodDisplay)}</span>
          <span class="card-count">${item.articleCount}${I18N.cardArticlesSuffix}</span>
        </div>
        <div class="card-title">${escapeHtml(item.topStory || item.title)}</div>
      `;
      card.addEventListener("click", () => selectItem(item));
      listContainer.appendChild(card);
    });
  }

  function setupTabs() {
    const calTabBtn = document.getElementById("tabCalendarBtn");
    const listTabBtn = document.getElementById("tabListBtn");
    const reportsTabBtn = document.getElementById("tabReportsBtn");
    const calTab = document.getElementById("calendarTab");
    const listTab = document.getElementById("listTab");
    const reportsTab = document.getElementById("reportsTab");

    function switchTab(activeBtn, activeContent) {
      [calTabBtn, listTabBtn, reportsTabBtn].forEach((b) => b?.classList.remove("active"));
      [calTab, listTab, reportsTab].forEach((c) => c?.classList.remove("active"));
      activeBtn?.classList.add("active");
      activeContent?.classList.add("active");
    }

    calTabBtn?.addEventListener("click", () => switchTab(calTabBtn, calTab));
    listTabBtn?.addEventListener("click", () => switchTab(listTabBtn, listTab));
    reportsTabBtn?.addEventListener("click", () => switchTab(reportsTabBtn, reportsTab));
  }

  function setupReportsFilter() {
    const filterButtons = document.querySelectorAll(".reports-filter-bar .filter-pill");
    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentReportFilter = btn.getAttribute("data-filter") || "all";
        renderPeriodicReportsList();
      });
    });
  }

  function setupSearch() {
    const searchInput = document.getElementById("searchInput");
    searchInput?.addEventListener("input", (e) => {
      renderBacknumberList(e.target.value.trim());
    });
  }

  function setupTheme() {
    const toggleBtn = document.getElementById("themeToggle");
    const savedTheme = localStorage.getItem("dtf_theme") || "dark";
    document.body.setAttribute("data-theme", savedTheme);
    updateThemeIcon(savedTheme);

    toggleBtn?.addEventListener("click", () => {
      const current = document.body.getAttribute("data-theme");
      const next = current === "light" ? "dark" : "light";
      document.body.setAttribute("data-theme", next);
      localStorage.setItem("dtf_theme", next);
      updateThemeIcon(next);
    });
  }

  function updateThemeIcon(theme) {
    const icon = document.querySelector(".theme-icon");
    if (icon) {
      icon.textContent = theme === "light" ? "☀️" : "🌙";
    }
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
