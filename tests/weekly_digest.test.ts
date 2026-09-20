import * as fs from "fs";
import * as path from "path";
import {
  getIsoWeekString,
  getDatesForIsoWeek,
  generateWeeklyDigest,
} from "../src/aggregation/weekly_digest";
import { PATHS } from "../src/core/paths";

describe("weekly_digest", () => {
  describe("getIsoWeekString", () => {
    it("should calculate correct ISO week string", () => {
      // 2026-09-20 is Sunday of week 38 in ISO-8601
      const d1 = new Date(Date.UTC(2026, 8, 20));
      expect(getIsoWeekString(d1)).toBe("2026-W38");

      // 2026-09-14 is Monday of week 38
      const d2 = new Date(Date.UTC(2026, 8, 14));
      expect(getIsoWeekString(d2)).toBe("2026-W38");
    });
  });

  describe("getDatesForIsoWeek", () => {
    it("should return start and end dates for a given ISO week", () => {
      const dates = getDatesForIsoWeek("2026-W38");
      expect(dates.startDate).toBe("2026-09-14");
      expect(dates.endDate).toBe("2026-09-20");
    });
  });

  describe("generateWeeklyDigest", () => {
    const testDir = path.join(PATHS.TMP_AI, "test_weekly");

    beforeAll(() => {
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterAll(() => {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("should return null gracefully when no summaries are present for week", async () => {
      const result = await generateWeeklyDigest("2030-W01");
      expect(result).toBeNull();
    });
  });
});
