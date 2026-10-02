/**
 * Tests for URL canonicalization (src/core/url.ts).
 */

import { canonicalizeUrl, normalizeUrl, dedupeByUrl } from "../src/core/url";

jest.mock("../src/core/config", () => ({
  config: { exclude: { url_strip_parameters: ["ref_src"] } },
}));

describe("canonicalizeUrl", () => {
  test("drops utm_* parameters and keeps content parameters", () => {
    expect(canonicalizeUrl("https://example.com/a?utm_source=x&utm_term=y&id=123")).toBe(
      "https://example.com/a?id=123"
    );
  });

  test("drops ad click IDs and the BBC's at_* campaign tags", () => {
    expect(
      canonicalizeUrl("https://www.bbc.com/news/articles/c1?at_medium=RSS&at_campaign=rss&fbclid=abc")
    ).toBe("https://www.bbc.com/news/articles/c1");
  });

  test("matches parameter names case-insensitively", () => {
    expect(canonicalizeUrl("https://example.com/a?UTM_Source=x&GCLID=1")).toBe("https://example.com/a");
  });

  test("drops the fragment and trims whitespace", () => {
    expect(canonicalizeUrl("  https://example.com/a#section-2 ")).toBe("https://example.com/a");
  });

  test("drops extra parameters passed by the caller", () => {
    expect(canonicalizeUrl("https://example.com/a?ref=feed&p=2", ["ref"])).toBe("https://example.com/a?p=2");
  });

  test("keeps scheme, host and path so distinct pages stay distinct", () => {
    expect(canonicalizeUrl("http://example.com/A/")).toBe("http://example.com/A/");
  });

  test("returns unparseable input trimmed", () => {
    expect(canonicalizeUrl(" not-a-url ")).toBe("not-a-url");
  });
});

describe("normalizeUrl", () => {
  test("also drops exclude.url_strip_parameters from config", () => {
    expect(normalizeUrl("https://example.com/a?ref_src=twsrc&utm_medium=rss")).toBe("https://example.com/a");
  });
});

describe("dedupeByUrl", () => {
  test("keeps the first item for each canonical URL in order", () => {
    const items = [
      { url: "https://example.com/a?utm_source=hn", source: "hn" },
      { url: "https://example.com/b", source: "rss" },
      { url: "https://example.com/a#comments", source: "rss" },
    ];
    expect(dedupeByUrl(items).map((i) => i.source + ":" + i.url)).toEqual([
      "hn:https://example.com/a?utm_source=hn",
      "rss:https://example.com/b",
    ]);
  });
});
