/**
 * [Role] Zenn.dev and note.com article publishing.
 * [Mechanism]
 * - Zenn: writes an article file (Zenn frontmatter + Markdown) to `publish/zenn/`. Zenn publishes
 *   from the `articles/` directory of a repository connected through its GitHub integration; the
 *   daily/weekly/monthly/yearly workflows copy the files there when the `ZENN_REPO` variable is set.
 * - note.com: writes a note-ready draft (title, HTML body, hashtags) to `publish/note/`. note.com has
 *   no public API; when `NOTE_API_TOKEN` (the `_note_session_v5` session cookie of a logged-in
 *   browser) is set, the draft is also created through note's internal editor API. That API is
 *   unofficial and the cookie expires, so a failure there leaves the draft file for manual posting.
 *
 * Item: 6.2 note.com / Zenn 連携
 */

import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as yaml from "yaml";
import { PATHS } from "../core/paths";
import { markdownToHtml } from "./pages_generator";
import type { PublishPayload, ReportKind } from "../core/plugin_registry";
import { asErrorLike, errorMessage } from "../core/errors";

// ── Shared ──

/**
 * Article slug for a report, e.g. "dtf-daily-2026-10-17" or "dtf-weekly-2026-w42". It satisfies
 * Zenn's slug rule (12-50 characters of a-z, 0-9, "-" and "_"), so it doubles as the file name.
 */
export function articleSlug(kind: ReportKind, period: string): string {
  const slug = `dtf-${kind}-${period.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`.slice(0, 50);
  return slug.length >= 12 ? slug : slug.padEnd(12, "-");
}

/** Replaces Obsidian wikilinks (`[[note|label]]`, `[[note]]`) with their plain label. */
export function stripWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => label ?? target);
}

// ── Zenn ──

/** Zenn topics: up to 5 lowercase alphanumeric names, without duplicates. */
export function toZennTopics(tags: readonly string[]): string[] {
  const topics: string[] = [];
  for (const tag of tags) {
    const topic = tag.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (topic.length === 0 || topic.length > 30 || topics.includes(topic)) continue;
    topics.push(topic);
    if (topics.length === 5) break;
  }
  return topics;
}

/** Builds a Zenn article file (frontmatter + body). */
export function buildZennArticle(
  title: string,
  content: string,
  topics: readonly string[],
  published: boolean = false,
): string {
  const frontmatter = yaml.stringify({
    title: title.slice(0, 70), // Zenn rejects titles longer than 70 characters
    emoji: "📊",
    type: "tech",
    topics: toZennTopics(topics),
    published,
  });
  return `---\n${frontmatter}---\n\n${stripWikiLinks(content).trim()}\n`;
}

/**
 * Writes a Zenn article file and returns its path.
 *
 * @param slug Article slug (also the file name), see `articleSlug`
 * @param title Article title
 * @param content Markdown content
 * @param topics Tags/topics for the article
 * @param published false keeps the article a draft on Zenn
 */
export function createZennDraft(
  slug: string,
  title: string,
  content: string,
  topics: string[] = ["AI", "Tech"],
  published: boolean = false,
  outputDir: string = PATHS.ARTIFACTS_ZENN.absolute,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${slug}.md`);
  fs.writeFileSync(filePath, buildZennArticle(title, content, topics, published), "utf8");
  console.log(`📝 Zenn article written: ${filePath}`);
  return filePath;
}

// ── note.com ──

const NOTE_API_BASE = "https://note.com/api/v1";
const NOTE_TIMEOUT_MS = 20_000;

export interface NoteDraft {
  title: string;
  /** HTML body: note.com does not render Markdown. */
  body: string;
  hashtags: string[];
}

export interface NoteDraftResult {
  id: number;
  key: string;
  editUrl: string;
}

/** Converts a Markdown report to the HTML subset accepted by note's editor (no classes, no wikilinks). */
export function buildNoteHtml(markdown: string): string {
  return markdownToHtml(stripWikiLinks(markdown)).replace(/\s+class="[^"]*"/g, "");
}

/** Builds the note draft for a report. */
export function buildNoteDraft(title: string, markdown: string, tags: readonly string[]): NoteDraft {
  const hashtags = [...new Set(tags.map((t) => t.replace(/[\s#]+/g, "")).filter((t) => t.length > 0))].slice(0, 10);
  return { title, body: buildNoteHtml(markdown), hashtags };
}

/** Writes the draft as JSON (for re-posting) and HTML (for pasting into the editor). Returns the JSON path. */
export function saveNoteDraftFile(
  slug: string,
  draft: NoteDraft,
  outputDir: string = PATHS.ARTIFACTS_NOTE.absolute,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${slug}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(draft, null, 2), "utf8");
  fs.writeFileSync(
    path.join(outputDir, `${slug}.html`),
    `<h1>${draft.title.replace(/</g, "&lt;")}</h1>\n${draft.body}\n`,
    "utf8",
  );
  console.log(`📝 note draft written: ${jsonPath}`);
  return jsonPath;
}

/** Cookie header for the note session: a bare token is the `_note_session_v5` value. */
export function noteCookieHeader(token: string): string {
  const trimmed = token.trim();
  return trimmed.includes("=") ? trimmed : `_note_session_v5=${trimmed}`;
}

/**
 * Creates a draft on note.com through the editor's internal API: `POST /text_notes` creates an
 * empty draft, then `POST /text_notes/draft_save?id=…` saves the title and HTML body (a full
 * overwrite). The draft stays unpublished. With `existing`, that draft is overwritten instead of
 * creating another one. Throws on failure (e.g. an expired session cookie).
 */
export async function publishToNote(
  draft: NoteDraft,
  token: string,
  existing?: NoteDraftResult,
): Promise<NoteDraftResult> {
  const headers = {
    Cookie: noteCookieHeader(token),
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Origin: "https://editor.note.com",
    Referer: "https://editor.note.com/",
  };

  let id: number;
  let key: string;
  if (existing) {
    ({ id, key } = existing);
  } else {
    const created = await axios.post(
      `${NOTE_API_BASE}/text_notes`,
      { template_key: null },
      { headers, timeout: NOTE_TIMEOUT_MS },
    );
    const data = created.data?.data ?? created.data;
    id = Number(data?.id);
    key = String(data?.key ?? "");
    if (!Number.isFinite(id) || id <= 0 || key === "") {
      throw new Error(`note.com did not return a draft id (status ${created.status})`);
    }
  }

  await axios.post(
    `${NOTE_API_BASE}/text_notes/draft_save?id=${id}&is_temp_saved=true`,
    { name: draft.title, body: draft.body, index: false, is_lead_form: false },
    { headers, timeout: NOTE_TIMEOUT_MS },
  );

  return { id, key, editUrl: `https://editor.note.com/notes/${key}/edit/` };
}

/** File recording the note.com draft created for a slug, so a re-run updates it instead of adding one. */
function noteRecordPath(outputDir: string, slug: string): string {
  return path.join(outputDir, `${slug}.note.json`);
}

/** Reads the note.com draft recorded for a slug, or undefined when there is none (or it is unreadable). */
export function readNoteRecord(outputDir: string, slug: string): NoteDraftResult | undefined {
  try {
    const record = JSON.parse(fs.readFileSync(noteRecordPath(outputDir, slug), "utf8")) as Partial<NoteDraftResult>;
    if (typeof record.id === "number" && record.id > 0 && typeof record.key === "string" && record.key !== "") {
      return { id: record.id, key: record.key, editUrl: `https://editor.note.com/notes/${record.key}/edit/` };
    }
  } catch {
    // No record yet
  }
  return undefined;
}

// ── Publishers ──

export interface ZennPublisherOptions {
  published: boolean;
  topics: string[];
  outputDir?: string;
}

/** Publishes a report as a Zenn article file. */
export function publishZennArticle(payload: PublishPayload, options: ZennPublisherOptions): string {
  return createZennDraft(
    articleSlug(payload.kind, payload.period),
    payload.title,
    payload.markdown,
    [...options.topics, ...payload.tags],
    options.published,
    options.outputDir,
  );
}

/**
 * Publishes a report as a note.com draft: the draft file is always written; the draft is also
 * created on note.com when a session token is given (and updated on a later run for the same period). Throws when the API call fails, after the
 * file has been written.
 */
export async function publishNoteDraft(
  payload: PublishPayload,
  token: string | undefined,
  outputDir?: string,
): Promise<NoteDraftResult | null> {
  const dir = outputDir ?? PATHS.ARTIFACTS_NOTE.absolute;
  const slug = articleSlug(payload.kind, payload.period);
  const draft = buildNoteDraft(payload.title, payload.markdown, payload.tags);
  saveNoteDraftFile(slug, draft, dir);
  if (!token) {
    console.log("ℹ️ note.com API posting skipped (NOTE_API_TOKEN not set); the draft file can be pasted manually.");
    return null;
  }
  // A re-run for the same period (e.g. a manual retry) overwrites the draft it created before.
  const existing = readNoteRecord(dir, slug);
  try {
    const result = await publishToNote(draft, token, existing);
    fs.writeFileSync(noteRecordPath(dir, slug), JSON.stringify({ id: result.id, key: result.key }) + "\n", "utf8");
    console.log(`✅ note.com draft ${existing ? "updated" : "created"}: ${result.editUrl}`);
    return result;
  } catch (error) {
    const status = asErrorLike(error).response?.status;
    const hint = status === 401 || status === 403 ? " (the session cookie may have expired; renew NOTE_API_TOKEN)" : "";
    throw new Error(
      `note.com draft creation failed${status ? ` with HTTP ${status}` : ""}: ${errorMessage(error)}${hint}`,
      {
        cause: error,
      },
    );
  }
}
