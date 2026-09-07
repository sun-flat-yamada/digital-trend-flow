/**
 * Tests for feed_generator.ts — Atom feed XML generation.
 */

import * as fs from "fs";
import * as path from "path";
import { generateAtomFeed } from "../src/publishing/feed_generator";
import { PATHS } from "../src/core/paths";

describe("generateAtomFeed", () => {
  const testDir = path.join(PATHS.TMP_AI, "test_feed");

  beforeAll(() => {
    const now = new Date();
    const d1 = new Date(now.getTime() - 86400000);
    const d2 = new Date(now.getTime() - 2 * 86400000);

    const ds1 = d1.toISOString().split("T")[0];
    const y1 = d1.getFullYear().toString();
    const m1 = (d1.getMonth() + 1).toString().padStart(2, "0");
    const dir1 = path.join(testDir, y1, m1);
    fs.mkdirSync(dir1, { recursive: true });

    fs.writeFileSync(
      path.join(dir1, `${ds1}_digital-trend_daily_summary.md`),
      `---
title: "Daily Summary ${ds1}"
articles_processed: 12
categories:
  - AI Research
  - Business
---

## 🔥 Top News
Test content for day 1.
`,
      "utf8"
    );

    const ds2 = d2.toISOString().split("T")[0];
    const y2 = d2.getFullYear().toString();
    const m2 = (d2.getMonth() + 1).toString().padStart(2, "0");
    const dir2 = path.join(testDir, y2, m2);
    fs.mkdirSync(dir2, { recursive: true });

    fs.writeFileSync(
      path.join(dir2, `${ds2}_digital-trend_daily_summary.md`),
      `---
title: "Daily Summary ${ds2}"
articles_processed: 8
---

## 🔥 Top News
Test content for day 2.
`,
      "utf8"
    );
  });

  afterAll(() => {
    // Clean up
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("generates valid Atom XML", () => {
    const feedPath = generateAtomFeed(testDir);
    expect(fs.existsSync(feedPath)).toBe(true);

    const content = fs.readFileSync(feedPath, "utf8");
    expect(content).toContain('<?xml version="1.0"');
    expect(content).toContain("<feed xmlns=");
    expect(content).toContain("<entry>");
    expect(content).toContain("Digital Trend Flow");
  });

  test("includes entries for each summary file", () => {
    const feedPath = generateAtomFeed(testDir);
    const content = fs.readFileSync(feedPath, "utf8");

    // Should have 2 entries
    const entryCount = (content.match(/<entry>/g) || []).length;
    expect(entryCount).toBe(2);
  });

  test("handles empty directory", () => {
    const emptyDir = path.join(PATHS.TMP_AI, "test_feed_empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const feedPath = generateAtomFeed(emptyDir);
    expect(fs.existsSync(feedPath)).toBe(true);

    const content = fs.readFileSync(feedPath, "utf8");
    expect(content).toContain("<feed xmlns=");
    // No entries
    expect(content).not.toContain("<entry>");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
