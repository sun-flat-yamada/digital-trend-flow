/**
 * [Role] CLI tool to trigger GitHub Pages static site generation.
 * Usage:
 *   npx ts-node src/cli/build_pages.ts
 *   npm run build:pages
 */

import { generatePagesSite } from "../publishing/pages_generator";
import { PATHS } from "../core/paths";

function run() {
  console.log("🚀 Building GitHub Pages static site...");
  const result = generatePagesSite();
  console.log(`✅ GitHub Pages build completed successfully!`);
  console.log(`   Output: ${result.outputPath}`);
  console.log(`   Summaries indexed: ${result.summaryCount}`);
  if (result.latestDate) {
    console.log(`   Latest headline date: ${result.latestDate}`);
  }
}

run();
