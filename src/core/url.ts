/**
 * [Role] Canonical form of article URLs, used for de-duplication and the processed-URL state.
 * [Mechanism] Drops the fragment and tracking query parameters (utm_*, ad click IDs, the BBC's
 * at_* campaign tags, plus `exclude.url_strip_parameters` from config.yml). Scheme, host, path
 * and every other parameter are kept, so distinct pages never collapse into one.
 */

import { config } from "./config";

// Parameters that only track the visit and never select content.
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "igshid",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok",
  "at_medium", "at_campaign", "at_custom1", "at_custom2", "at_custom3", "at_custom4",
  "at_link_id", "at_link_type", "at_link_origin", "at_ptr_name", "at_format", "at_bbc_team",
]);
const TRACKING_PARAM_PREFIXES = ["utm_"];

/**
 * Returns the canonical form of a URL. Unparseable input is returned trimmed but otherwise as-is.
 * @param extraParams Additional query parameter names to drop (case-insensitive).
 */
export function canonicalizeUrl(rawUrl: string, extraParams: readonly string[] = []): string {
  const trimmed = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const extra = new Set(extraParams.map((p) => p.toLowerCase()));
  for (const key of [...url.searchParams.keys()]) {
    const name = key.toLowerCase();
    if (TRACKING_PARAMS.has(name) || extra.has(name) || TRACKING_PARAM_PREFIXES.some((p) => name.startsWith(p))) {
      url.searchParams.delete(key);
    }
  }
  // Always re-serialize the query (as the previous implementation did), so canonical forms
  // recorded before and after this change compare equal.
  url.search = url.searchParams.toString();
  url.hash = "";
  return url.toString();
}

/** Canonicalizes a URL, also dropping `exclude.url_strip_parameters` from config.yml. */
export function normalizeUrl(
  rawUrl: string,
  stripParameters: readonly string[] = config.exclude.url_strip_parameters
): string {
  return canonicalizeUrl(rawUrl, stripParameters);
}

/** Keeps the first item for each canonical URL, preserving order. */
export function dedupeByUrl<T extends { url: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = normalizeUrl(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
