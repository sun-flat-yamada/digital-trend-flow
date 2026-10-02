/**
 * Tests for choosing which Raindrop bookmarks are moved to the archive collection.
 */

import { archivableRaindropIds } from "../src/ingestion/raindrop";

jest.mock("../src/core/config", () => ({
  config: { exclude: { url_strip_parameters: [] } },
  env: {},
}));
jest.mock("../src/ingestion/state_manager", () => ({ isProcessed: jest.fn(() => false) }));

describe("archivableRaindropIds", () => {
  test("archives earlier-processed bookmarks and those summarized in this run only", () => {
    const result = {
      articles: [],
      processedIds: [1, 2],
      idByUrl: { "https://example.com/summarized": 10, "https://example.com/excluded": 11 },
    };

    expect(archivableRaindropIds(result, ["https://example.com/summarized?utm_source=raindrop"])).toEqual([1, 2, 10]);
  });

  test("archives nothing new when no bookmark was summarized", () => {
    expect(archivableRaindropIds({ articles: [], processedIds: [], idByUrl: { "https://example.com/a": 5 } }, [])).toEqual([]);
  });
});
