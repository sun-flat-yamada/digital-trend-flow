/**
 * Tests for note_api.ts: Zenn article files and note.com drafts.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));

import axios from "axios";
import {
  articleSlug,
  buildZennArticle,
  buildNoteHtml,
  noteCookieHeader,
  publishNoteDraft,
  publishZennArticle,
  publishToNote,
  stripWikiLinks,
  toZennTopics,
} from "../src/publishing/note_api";
import type { PublishPayload } from "../src/core/plugin_registry";

const mockPost = axios.post as jest.Mock;
const tmpDir = path.join(process.cwd(), "_tmp_ai", "test_note_api");

const payload: PublishPayload = {
  kind: "weekly",
  title: "Weekly Trend Report 2026-W42 (2026-10-12 ~ 2026-10-18)",
  markdown:
    "## 📈 今週のトレンド概要\n\n**OpenAI** の発表。[出典](https://example.com/a)\n\n← [[2026-10-17_digital-trend_daily_summary|前日のサマリー]]",
  articleCount: 42,
  date: "2026-10-18",
  period: "2026-W42",
  language: "ja",
  tags: ["LLM", "AI Agent", "llm", "生成AI"],
};

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

beforeEach(() => mockPost.mockReset());

describe("Zenn", () => {
  test("articleSlug satisfies Zenn's slug rule", () => {
    for (const slug of [
      articleSlug("daily", "2026-10-17"),
      articleSlug("weekly", "2026-W42"),
      articleSlug("yearly", "2026"),
    ]) {
      expect(slug).toMatch(/^[a-z0-9_-]{12,50}$/);
    }
    expect(articleSlug("weekly", "2026-W42")).toBe("dtf-weekly-2026-w42");
  });

  test("toZennTopics keeps up to 5 lowercase alphanumeric unique topics", () => {
    expect(toZennTopics(["AI", "ai", "AI Agent", "生成AI", "LLM", "Tech", "Rust", "Go"])).toEqual([
      "ai",
      "aiagent",
      "llm",
      "tech",
      "rust",
    ]);
  });

  test("buildZennArticle writes valid frontmatter and strips wikilinks", () => {
    const article = buildZennArticle('A "quoted": title', "Body ← [[note|Previous]]", ["AI"], false);
    const match = article.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
    expect(match).not.toBeNull();
    expect(yaml.parse(match![1]!)).toEqual({
      title: 'A "quoted": title',
      emoji: "📊",
      type: "tech",
      topics: ["ai"],
      published: false,
    });
    expect(match![2]).toBe("Body ← Previous\n");
  });

  test("publishZennArticle writes the article under its slug", () => {
    const file = publishZennArticle(payload, { published: false, topics: ["tech"], outputDir: tmpDir });
    expect(path.basename(file)).toBe("dtf-weekly-2026-w42.md");
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("topics:\n  - tech\n  - llm\n  - aiagent");
    expect(content).not.toContain("[[");
  });
});

describe("note.com", () => {
  test("buildNoteHtml renders Markdown without classes or wikilinks", () => {
    const html = buildNoteHtml(payload.markdown);
    expect(html).toContain("<h2>");
    expect(html).toContain('<a href="https://example.com/a"');
    expect(html).not.toContain("class=");
    expect(html).not.toContain("[[");
  });

  test("noteCookieHeader accepts a bare session value or a cookie string", () => {
    expect(noteCookieHeader(" abc ")).toBe("_note_session_v5=abc");
    expect(noteCookieHeader("_note_session_v5=abc; other=1")).toBe("_note_session_v5=abc; other=1");
  });

  test("publishToNote creates an empty draft, then saves the title and body", async () => {
    mockPost
      .mockResolvedValueOnce({ status: 201, data: { data: { id: 123, key: "n0abc" } } })
      .mockResolvedValueOnce({ status: 200, data: { data: { result: true } } });

    const result = await publishToNote({ title: "T", body: "<p>B</p>", hashtags: [] }, "session");

    expect(result).toEqual({ id: 123, key: "n0abc", editUrl: "https://editor.note.com/notes/n0abc/edit/" });
    expect(mockPost.mock.calls[0]![0]).toBe("https://note.com/api/v1/text_notes");
    expect(mockPost.mock.calls[0]![2].headers.Cookie).toBe("_note_session_v5=session");
    expect(mockPost.mock.calls[1]![0]).toBe("https://note.com/api/v1/text_notes/draft_save?id=123&is_temp_saved=true");
    expect(mockPost.mock.calls[1]![1]).toMatchObject({ name: "T", body: "<p>B</p>" });
  });

  test("publishNoteDraft writes the draft file and skips the API without a token", async () => {
    const result = await publishNoteDraft(payload, undefined, tmpDir);
    expect(result).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
    const draft = JSON.parse(fs.readFileSync(path.join(tmpDir, "dtf-weekly-2026-w42.json"), "utf8"));
    expect(draft.title).toBe(payload.title);
    expect(draft.hashtags).toEqual(["LLM", "AIAgent", "llm", "生成AI"]);
    expect(fs.existsSync(path.join(tmpDir, "dtf-weekly-2026-w42.html"))).toBe(true);
  });

  test("publishNoteDraft explains an expired session", async () => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error("Request failed"), { response: { status: 401 } }));
    await expect(publishNoteDraft(payload, "expired", tmpDir)).rejects.toThrow(/HTTP 401.*renew NOTE_API_TOKEN/);
  });
});

test("stripWikiLinks keeps the label or the target", () => {
  expect(stripWikiLinks("[[a|b]] and [[c]]")).toBe("b and c");
});
