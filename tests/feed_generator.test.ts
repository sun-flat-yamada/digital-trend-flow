/**
 * Tests for feed_generator.ts — Atom feed XML for the Pages site.
 */

import { buildAtomFeed, resolveSiteUrl, FEED_ENTRY_LIMIT } from "../src/publishing/feed_generator";

const SITE = "https://owner.github.io/repo/";
const UPDATED = "2026-10-02T00:00:00.000Z";

describe("buildAtomFeed", () => {
  const entries = [
    { date: "2026-10-01", title: "Daily Summary 2026-10-01", topStory: "Model <X> & friends", articleCount: 4 },
    { date: "2026-09-30", title: "Daily Summary 2026-09-30", topStory: "", articleCount: 7 },
  ];

  test("links each entry to its deep link on the site", () => {
    const xml = buildAtomFeed(entries, SITE, UPDATED);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<link href="https://owner.github.io/repo/feed.xml" rel="self" type="application/atom+xml"/>');
    expect(xml).toContain('<link href="https://owner.github.io/repo/#2026-10-01" rel="alternate" type="text/html"/>');
    expect(xml).toContain(`<updated>${UPDATED}</updated>`);
    expect((xml.match(/<entry>/g) ?? []).length).toBe(2);
  });

  test("escapes text and falls back to the article count as summary", () => {
    const xml = buildAtomFeed(entries, SITE, UPDATED);

    expect(xml).toContain("<summary>Model &lt;X&gt; &amp; friends (4 articles)</summary>");
    expect(xml).toContain("<summary>7 articles</summary>");
  });

  test("uses relative links without a site URL", () => {
    const xml = buildAtomFeed(entries, null, UPDATED);

    expect(xml).toContain('<link href="feed.xml" rel="self"');
    expect(xml).toContain('<link href="#2026-10-01" rel="alternate"');
  });

  test("keeps the newest entries only, and handles no entries", () => {
    const many = Array.from({ length: FEED_ENTRY_LIMIT + 5 }, (_, i) => ({ ...entries[0]!, date: `2026-01-${i}` }));
    expect((buildAtomFeed(many, SITE, UPDATED).match(/<entry>/g) ?? []).length).toBe(FEED_ENTRY_LIMIT);
    expect(buildAtomFeed([], SITE, UPDATED)).not.toContain("<entry>");
  });
});

describe("resolveSiteUrl", () => {
  test("prefers PAGES_BASE_URL and adds a trailing slash", () => {
    expect(resolveSiteUrl({ PAGES_BASE_URL: "https://example.com/trends", GITHUB_REPOSITORY: "o/r" })).toBe(
      "https://example.com/trends/"
    );
  });

  test("derives the project site URL from GITHUB_REPOSITORY", () => {
    expect(resolveSiteUrl({ GITHUB_REPOSITORY: "Sun-Flat-Yamada/digital-trend-flow" })).toBe(
      "https://sun-flat-yamada.github.io/digital-trend-flow/"
    );
  });

  test("handles a user site repository and missing variables", () => {
    expect(resolveSiteUrl({ GITHUB_REPOSITORY: "owner/owner.github.io" })).toBe("https://owner.github.io/");
    expect(resolveSiteUrl({})).toBeNull();
  });
});
