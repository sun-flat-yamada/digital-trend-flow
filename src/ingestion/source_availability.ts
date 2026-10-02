/**
 * [Role] Decides which configured sources are fetched in a run.
 * [Mechanism] A source is skipped when config.yml sets `enabled: false`, when the API key it
 * needs is missing, or when its module is disabled in code. The reason is recorded as the
 * source's "disabled" status, so skipped sources are not mistaken for failing feeds.
 */

import { env } from "../core/config";
import type { Source } from "../core/types";
import { XAI_GROK_DISABLED_REASON } from "./xai_grok";

/** Returns why a source is skipped this run, or null when it should be fetched. */
export function sourceDisabledReason(source: Source): string | null {
  if (source.enabled === false) return "enabled: false in config.yml";
  switch (source.type) {
    case "raindrop":
      return env.RAINDROP_TEST_TOKEN ? null : "RAINDROP_TEST_TOKEN not set";
    case "youtube":
      return env.YOUTUBE_API_KEY ? null : "YOUTUBE_API_KEY not set";
    case "xai_grok":
      return XAI_GROK_DISABLED_REASON ?? (env.XAI_API_KEY ? null : "XAI_API_KEY not set");
    default:
      return null;
  }
}
