/**
 * Tests for the webhook notifiers: Slack mrkdwn conversion, truncation at section boundaries and
 * boilerplate in the report's language.
 */

jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock("../src/core/config", () => ({
  env: {
    DISCORD_WEBHOOK_URL: "https://discord.example/hook",
    SLACK_WEBHOOK_URL: "https://slack.example/hook",
    TEAMS_WEBHOOK_URL: "https://teams.example/hook",
  },
  config: { settings: {} },
}));

import axios from "axios";
import { markdownToSlackMrkdwn, notifyStrings, truncateAtSection } from "../src/publishing/notify_common";
import { notifyDiscord } from "../src/publishing/discord_notifier";
import { notifySlack } from "../src/publishing/slack_notifier";
import { notifyTeams } from "../src/publishing/teams_notifier";

const mockPost = axios.post as jest.Mock;

beforeEach(() => {
  mockPost.mockReset().mockResolvedValue({});
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("markdownToSlackMrkdwn", () => {
  test("converts links, bold, italic, headings, bullets and rules", () => {
    const md = [
      "## 🔥 Top Story",
      "### **Big** news",
      "**Source**: [Blog & News](https://example.com/a?b=1&c=2) | *new*",
      "- item one",
      "* item two",
      "---",
      "> quoted",
    ].join("\n");
    expect(markdownToSlackMrkdwn(md)).toBe(
      [
        "*🔥 Top Story*",
        "*Big news*",
        "*Source*: <https://example.com/a?b=1&amp;c=2|Blog &amp; News> | _new_",
        "• item one",
        "• item two",
        "──────────",
        "> quoted",
      ].join("\n"),
    );
  });

  test("escapes <, > and & in text so Slack does not read them as control sequences", () => {
    expect(markdownToSlackMrkdwn("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
  });

  test("keeps non-http links as plain text", () => {
    expect(markdownToSlackMrkdwn("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
  });
});

describe("truncateAtSection", () => {
  const sections = ["## A", "a".repeat(400), "## B", "b".repeat(400), "## C", "c".repeat(400)].join("\n");

  test("returns short text unchanged", () => {
    expect(truncateAtSection("short", 100, "NOTICE")).toBe("short");
  });

  test("cuts at the last heading before the limit and appends the notice within the limit", () => {
    const out = truncateAtSection(sections, 1000, "NOTICE");
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toContain("## B\n" + "b".repeat(400));
    expect(out).not.toContain("## C");
    expect(out.endsWith("\n\nNOTICE")).toBe(true);
  });

  test("falls back to a line break, then a hard cut, without exceeding the limit", () => {
    const out = truncateAtSection("x".repeat(500), 100, "NOTICE");
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("NOTICE")).toBe(true);
  });
});

describe("notifyStrings", () => {
  test("Japanese for ja / Japanese, English otherwise", () => {
    expect(notifyStrings("ja").processed(3)).toBe("3 件の記事を処理");
    expect(notifyStrings("Japanese").fullReport).toContain("全文");
    expect(notifyStrings("en").processed(3)).toBe("Processed 3 articles");
    expect(notifyStrings("fr").fullReport).toContain("full report");
  });
});

describe("notifiers", () => {
  const long = [
    "## 🔥 Top",
    "**Source**: [S](https://s.example.com)",
    ...Array.from({ length: 40 }, (_, i) => `## Section ${i}\n${"x".repeat(150)}`),
  ].join("\n");

  test("Slack sends mrkdwn within the section limit, with English boilerplate", async () => {
    await notifySlack("Daily Summary", long, 7, "en");
    const body = mockPost.mock.calls[0]![1];
    const section = body.blocks[1].text;
    expect(section.type).toBe("mrkdwn");
    expect(section.text.length).toBeLessThanOrEqual(3000);
    expect(section.text).toContain("*🔥 Top*");
    expect(section.text).toContain("<https://s.example.com|S>");
    expect(section.text).not.toContain("**");
    expect(section.text).toContain("full report");
    expect(body.blocks[2].elements[0].text).toBe("Processed 7 articles | Digital Trend Flow");
  });

  test("Discord and Teams use the Japanese boilerplate for a Japanese report", async () => {
    await notifyDiscord("日次サマリー", long, 7, "ja");
    const embed = mockPost.mock.calls[0]![1].embeds[0];
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(embed.description).toContain("全文は GitHub リポジトリ");
    expect(embed.footer.text).toBe("7 件の記事を処理 | Obsidian HeadQuarter");

    await notifyTeams("日次サマリー", long + "\n" + "y".repeat(5000), 7, "ja");
    const card = mockPost.mock.calls[1]![1].attachments[0].content;
    expect(card.body[1].text).toContain("全文は GitHub リポジトリ");
    expect(card.body[2].text).toBe("7 件の記事を処理 | Digital Trend Flow");
  });

  test("English boilerplate by default", async () => {
    await notifyDiscord("Daily Summary", long, 2);
    expect(mockPost.mock.calls[0]![1].embeds[0].description).toContain("full report");
  });
});
