import { config } from "../core/config";

/**
 * ============================================================================
 * Configuration Validation Script (MECE)
 * ============================================================================
 * 
 * Ensures logical consistency across the nested purpose -> sources structure.
 * Tests go beyond Zod's schema validation (which already passed if `config` loaded)
 * to check uniqueness, valid quoting, and sufficient data presence.
 */

function runConfigTests() {
  console.log("🛠️ Starting Configuration Validation (MECE)...");

  let errors = 0;
  let warnings = 0;

  const warn = (msg: string) => {
    console.warn(`⚠️ Warning: ${msg}`);
    warnings++;
  };

  const error = (msg: string) => {
    console.error(`❌ Error: ${msg}`);
    errors++;
  };

  // --- 1. Data Reachability ---
  const purposeKeys = Object.keys(config.purposes);
  if (purposeKeys.length === 0) {
    error("No purpose categories defined in config.yml.");
  }

  let totalSources = 0;
  for (const [key, purpose] of Object.entries(config.purposes)) {
    totalSources += purpose.sources?.length || 0;
    if (!purpose.sources || purpose.sources.length === 0) {
      warn(`Purpose category '${key}' has no sources mapped to it.`);
    }
  }

  if (totalSources === 0) {
    error("No information sources defined across any purpose category.");
  } else {
    console.log(`✅ Found ${totalSources} total sources across ${purposeKeys.length} purpose(s).`);
  }

  // --- 2. Uniqueness Constraints ---
  const sourceNames = new Set<string>();
  const sourceUrls = new Set<string>();
  const priorities = new Set<number>();

  for (const [key, purpose] of Object.entries(config.purposes)) {
    // Priority uniqueness
    if (priorities.has(purpose.priority)) {
      warn(`Purpose '${key}' shares priority level ${purpose.priority} with another purpose. Tying priorities may lead to unstable sorting.`);
    }
    priorities.add(purpose.priority);

    // Iterating sources
    for (const source of purpose.sources || []) {
      // Name uniqueness
      if (sourceNames.has(source.name)) {
        error(`Duplicate source name found: "${source.name}" in purpose '${key}'. Names should be unique.`);
      }
      sourceNames.add(source.name);

      // URL uniqueness for RSS
      if (source.type === "rss" && "url" in source) {
        if (sourceUrls.has(source.url)) {
          error(`Duplicate RSS URL found: "${source.url}" in purpose '${key}'. URLs must be unique.`);
        }
        sourceUrls.add(source.url);
      }
    }
  }
  console.log("✅ Checked uniqueness constraints (names, URLs, priorities).");

  // --- 3. Quota Consistency ---
  for (const [key, purpose] of Object.entries(config.purposes)) {
    const min = purpose.quota.min;
    const max = purpose.quota.max;
    
    if (min > max) {
      error(`Purpose '${key}' has invalid quota: min (${min}) > max (${max}).`);
    }

    // A max of 0 effectively disables the category showing in the output, which might be a mistake.
    if (max === 0) {
      warn(`Purpose '${key}' has a max quota of 0, effectively disabling it from final summary.`);
    }
  }
  console.log("✅ Checked quota bounds (min <= max).");

  // --- Summary ---
  console.log("\n=================================");
  console.log(`Validation Completed. Errors: ${errors}, Warnings: ${warnings}`);
  if (errors > 0) {
    console.error("❌ Configuration validation failed.");
    process.exit(1);
  } else {
    console.log("🎉 Configuration is valid!");
    process.exit(0);
  }
}

runConfigTests();
