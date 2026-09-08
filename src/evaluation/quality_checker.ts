/**
 * [Role] Quality Agent — Automated output quality evaluation.
 * [Mechanism] Validates the Reduce output against structural, citation,
 * and linguistic criteria to detect quality regressions.
 *
 * Items: 7.2 LLM 出力自動評価, 8.2 Quality Agent
 */

export interface QualityCheckResult {
  overallScore: number; // 0-100
  checks: QualityCheck[];
  passCount: number;
  failCount: number;
}

interface QualityCheck {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

/**
 * Evaluates the quality of a generated summary.
 */
export function evaluateQuality(
  summaryMarkdown: string,
  expectedSourceUrls: string[],
  targetLanguage: string = "en"
): QualityCheckResult {
  const checks: QualityCheck[] = [];

  // 1. Format Compliance: Required sections
  checks.push(checkRequiredSections(summaryMarkdown));

  // 2. Length Compliance: target length range
  checks.push(checkLength(summaryMarkdown));

  // 3. Citation Accuracy: Source URLs present
  checks.push(checkCitations(summaryMarkdown, expectedSourceUrls));

  // 4. Language Check: Content language matches targetLanguage
  checks.push(checkLanguage(summaryMarkdown, targetLanguage));

  // 5. Markdown Validity: No broken links or formatting
  checks.push(checkMarkdownStructure(summaryMarkdown));

  // 6. No Hallucinated Sections: Empty categories should be omitted
  checks.push(checkNoEmptySections(summaryMarkdown));

  // 7. Actionable Insights: Technical breakthrough & engineering recommendations
  checks.push(checkActionableInsights(summaryMarkdown));

  const passCount = checks.filter((c) => c.passed).length;
  const failCount = checks.filter((c) => !c.passed).length;
  const overallScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;

  return { overallScore, checks, passCount, failCount };
}

function checkRequiredSections(markdown: string): QualityCheck {
  const lower = markdown.toLowerCase();
  const hasTopNews =
    markdown.includes("🔥") ||
    markdown.includes("最重要") ||
    lower.includes("top story") ||
    lower.includes("top news");
  const hasSections = (markdown.match(/^## /gm) ?? []).length >= 2;

  const passed = hasTopNews && hasSections;
  return {
    name: "Format Compliance",
    passed,
    score: passed ? 100 : hasTopNews || hasSections ? 50 : 0,
    detail: passed
      ? "Required sections present (🔥 top news + category sections)"
      : `Missing: ${!hasTopNews ? "Top News section" : ""} ${!hasSections ? "Category sections" : ""}`.trim(),
  };
}

function checkLength(markdown: string): QualityCheck {
  const length = markdown.length;
  const isInRange = length >= 1200 && length <= 8000;
  const score = isInRange
    ? 100
    : length < 1200
      ? Math.max(0, (length / 1200) * 100)
      : Math.max(0, 100 - ((length - 8000) / 8000) * 100);

  return {
    name: "Length Compliance",
    passed: isInRange,
    score: Math.round(score),
    detail: `${length} chars (target: 1,200-8,000)`,
  };
}

function checkCitations(markdown: string, expectedUrls: string[]): QualityCheck {
  if (expectedUrls.length === 0) {
    return { name: "Citation Accuracy", passed: true, score: 100, detail: "No citations expected" };
  }

  // Count how many expected URLs appear in the output
  const found = expectedUrls.filter((url) => markdown.includes(url));
  const ratio = found.length / expectedUrls.length;
  const passed = ratio >= 0.5; // At least 50% citations present

  return {
    name: "Citation Accuracy",
    passed,
    score: Math.round(ratio * 100),
    detail: `${found.length}/${expectedUrls.length} source URLs cited (${(ratio * 100).toFixed(0)}%)`,
  };
}

function checkLanguage(markdown: string, targetLanguage: string = "en"): QualityCheck {
  const isJa = targetLanguage.toLowerCase() === "ja" || targetLanguage.toLowerCase() === "japanese";
  const totalChars = markdown.length;

  if (isJa) {
    // Count Japanese characters (Hiragana/Katakana/Kanji)
    const japaneseChars = (markdown.match(/[\u3000-\u9FFF\uF900-\uFAFF]/g) ?? []).length;
    const japaneseRatio = totalChars > 0 ? japaneseChars / totalChars : 0;
    const passed = japaneseRatio >= 0.15; // At least 15% Japanese
    return {
      name: "Language Check",
      passed,
      score: passed ? 100 : Math.round(japaneseRatio * 100 * 6),
      detail: `Japanese character ratio: ${(japaneseRatio * 100).toFixed(1)}% (min: 15%)`,
    };
  }

  const isEn = targetLanguage.toLowerCase() === "en" || targetLanguage.toLowerCase() === "english";
  if (isEn) {
    const latinChars = (markdown.match(/[a-zA-Z]/g) ?? []).length;
    const latinRatio = totalChars > 0 ? latinChars / totalChars : 0;
    const passed = latinRatio >= 0.40; // At least 40% Latin letters for English markdown
    return {
      name: "Language Check",
      passed,
      score: passed ? 100 : Math.round(latinRatio * 100 * 2.5),
      detail: `English/Latin letter ratio: ${(latinRatio * 100).toFixed(1)}% (min: 40%)`,
    };
  }

  // Arbitrary language: ensure non-trivial content length
  const passed = totalChars >= 500;
  return {
    name: "Language Check",
    passed,
    score: passed ? 100 : 50,
    detail: `Language check for ${targetLanguage}: ${totalChars} chars`,
  };
}

function checkMarkdownStructure(markdown: string): QualityCheck {
  const issues: string[] = [];

  // Check for broken markdown links: [text]() or [](url)
  const brokenLinks = (markdown.match(/\[\]\([^)]+\)|\[[^\]]+\]\(\)/g) ?? []).length;
  if (brokenLinks > 0) issues.push(`${brokenLinks} broken link(s)`);

  // Check for unclosed formatting
  const asteriskCount = (markdown.match(/\*\*/g) ?? []).length;
  if (asteriskCount % 2 !== 0) issues.push("Unclosed bold formatting");

  const passed = issues.length === 0;
  return {
    name: "Markdown Structure",
    passed,
    score: passed ? 100 : Math.max(0, 100 - issues.length * 30),
    detail: passed ? "Valid markdown structure" : issues.join("; "),
  };
}

function checkNoEmptySections(markdown: string): QualityCheck {
  // Look for sections with headers but no content
  const sections = markdown.split(/^## /m).slice(1); // Split on H2
  let emptySections = 0;

  for (const section of sections) {
    const lines = section.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= 1) emptySections++; // Only the header line
  }

  const passed = emptySections === 0;
  return {
    name: "No Empty Sections",
    passed,
    score: passed ? 100 : Math.max(0, 100 - emptySections * 25),
    detail: passed ? "All sections have content" : `${emptySections} empty section(s) found`,
  };
}

function checkActionableInsights(markdown: string): QualityCheck {
  const lower = markdown.toLowerCase();
  const hasBreakthrough =
    markdown.includes("ブレークスルー") ||
    markdown.includes("技術") ||
    markdown.includes("性能向上") ||
    markdown.includes("新機能") ||
    lower.includes("breakthrough") ||
    lower.includes("advance") ||
    lower.includes("quantitative") ||
    lower.includes("technical") ||
    lower.includes("novelty") ||
    lower.includes("innovation") ||
    lower.includes("architecture");

  const hasAction =
    markdown.includes("アクション") ||
    markdown.includes("推奨") ||
    markdown.includes("トレードオフ") ||
    markdown.includes("影響") ||
    markdown.includes("検証") ||
    lower.includes("trade-off") ||
    lower.includes("tradeoff") ||
    lower.includes("adoption") ||
    lower.includes("consideration") ||
    lower.includes("action") ||
    lower.includes("recommend") ||
    lower.includes("poc") ||
    lower.includes("guidance");

  const passed = hasBreakthrough && hasAction;
  return {
    name: "Actionable Insights",
    passed,
    score: passed ? 100 : hasBreakthrough || hasAction ? 70 : 30,
    detail: passed
      ? "Actionable engineering insights present"
      : "Missing explicit technical breakthrough or engineering recommendations",
  };
}
