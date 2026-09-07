import { extractMarkdownViaJina } from "../ingestion/jina_reader";
import { calculateScore, normalizeUrl, ArticleData } from "../filtering/scorer";

async function main() {
  const urlArg = process.argv[2];

  if (!urlArg) {
    console.error("❌ Usage: npm run debug:filter <URL>");
    process.exit(1);
  }

  const url = normalizeUrl(urlArg);
  console.log(`\n🔍 Starting Dry-Run for URL: ${url}`);
  
  try {
    console.log("⏳ Fetching content via Jina Reader...");
    const markdownStr = await extractMarkdownViaJina(url);
    
    if (!markdownStr) {
      console.log("❌ Failed to extract meaningful content or returned empty.");
      process.exit(1);
    }

    console.log(`✅ Extraction successful. Length: ${markdownStr.length} chars.`);
    
    const firstLine = markdownStr.split("\n")[0]?.replace(/^#+\s*/, "").trim() || "Unknown Title";

    const articleData: ArticleData = {
      url,
      title: firstLine,
      content: markdownStr,
    };

    console.log("\n🧪 Running Purpose-Aware Scoring Engine...");
    const result = calculateScore(articleData);

    console.log("\n================ DRY RUN RESULT ================");
    console.log(`Title: "${articleData.title}"`);
    console.log(`Status: ${result.isExcluded ? "❌ EXCLUDED" : "✅ PASSED"}`);
    
    if (result.isExcluded) {
      console.log(`Reason: ${result.exclusionReason}`);
    } else {
      console.log(`Assigned Purpose: ${result.purposeLabel} (${result.assignedPurpose})`);
      console.log(`Total Score: ${result.totalScore}`);
      console.log(`Matched Keywords: ${result.matchedKeywords.join(", ")}`);
    }
    console.log("================================================");
    
  } catch (err: any) {
    console.error("❌ Error during dry-run:", err.message);
  }
}

main();
