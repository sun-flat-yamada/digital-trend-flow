/**
 * [Role] CLI tool to trigger GitHub Pages static site generation.
 * Usage:
 *   npx ts-node src/cli/build_pages.ts
 *   npm run build:pages
 */

import { generatePagesSite } from "../publishing/pages_generator";
import { PATHS } from "../core/paths";

function run() {
  const language =
    process.argv[2] ||
    process.env.OUTPUT_LANGUAGE ||
    process.env.SUMMARY_LANGUAGE ||
    "en";

  console.log(`🚀 Building GitHub Pages static site (language: ${language})...`);
  const result = generatePagesSite(undefined, undefined, language);
  console.log(`✅ GitHub Pages build completed successfully!`);
  console.log(`   Output: ${result.outputPath}`);
  console.log(`   Summaries indexed: ${result.summaryCount}`);
  if (result.latestDate) {
    console.log(`   Latest headline date: ${result.latestDate}`);
  }
}

run();
