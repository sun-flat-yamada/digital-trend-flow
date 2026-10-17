/**
 * [Role] Output language of the summaries and reports.
 */

import { config } from "./config";

/** OUTPUT_LANGUAGE, then SUMMARY_LANGUAGE, then `settings.language` in config.yml ("en" by default). */
export function outputLanguage(): string {
  return process.env["OUTPUT_LANGUAGE"] || process.env["SUMMARY_LANGUAGE"] || config.settings?.language || "en";
}

/** True for Japanese ("ja", "Japanese"). */
export function isJapanese(language: string): boolean {
  return ["ja", "japanese"].includes(language.toLowerCase());
}
