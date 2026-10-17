/**
 * [Role] Markdown → HTML for the Pages site, the email notifier and note.com drafts.
 * [Mechanism] markdown-it with raw HTML disabled: any HTML in the Markdown (e.g. from LLM output)
 * is escaped. The only HTML kept is the fixed `<details>` / `<summary>` / `</details>` lines of the
 * execution metrics block, which are rebuilt from a strict pattern. Links are kept only for
 * http(s) URLs and open in a new tab.
 */

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
md.disable("image");
// Only http(s) links; anything else (javascript:, data:, relative paths) stays as text
md.validateLink = (url: string) => /^https?:\/\//i.test(url.trim());
// Plain URLs only, as before: no "example.com" or "README.md" without a scheme
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

/** True for a citation line (e.g. `**出典**: [..](..)`), rendered as `<div class="article-source">`. */
const isSourceLine = (text: string): boolean => text.includes("**出典**:") || text.includes("**Source**:");

// CSS classes of the Pages site (pages_assets/styles.css)
md.core.ruler.push("summary_classes", (state) => {
  const tokens = state.tokens;
  let quoteDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token.type) {
      case "heading_open":
        token.attrJoin("class", `summary-${token.tag}`);
        break;
      case "bullet_list_open":
      case "ordered_list_open":
        token.attrJoin("class", "summary-list");
        break;
      case "blockquote_open":
        if (quoteDepth++ === 0) token.attrJoin("class", "summary-quote");
        break;
      case "blockquote_close":
        quoteDepth--;
        break;
      case "hr":
        token.attrJoin("class", "summary-divider");
        break;
      case "paragraph_open": {
        if (token.hidden) break; // tight list item
        if (quoteDepth > 0) break; // plain <p> inside a quote, as styled by .summary-quote
        const close = tokens[i + 2];
        if (isSourceLine(tokens[i + 1]?.content ?? "") && close?.type === "paragraph_close") {
          token.tag = "div";
          close.tag = "div";
          token.attrJoin("class", "article-source");
        } else {
          token.attrJoin("class", "summary-p");
        }
        break;
      }
      case "inline":
        for (const child of token.children ?? []) {
          if (child.type === "link_open") {
            child.attrSet("target", "_blank");
            child.attrSet("rel", "noopener noreferrer");
            child.attrSet("class", "link");
          }
        }
        break;
    }
  }
});

/**
 * Rebuilds an allowed `<details>` / `<summary>` / `</details>` line as safe HTML, or returns null.
 * The input is never echoed: only a plain `class` name is kept on `<details>`, and the
 * `<summary>` text is rendered as inline Markdown like any other text.
 */
function toSafeDetailsTag(line: string): string | null {
  const detailsOpen = line.match(/^<details(?:\s+class="([\w-]+)")?\s*>$/);
  if (detailsOpen) {
    return detailsOpen[1] ? `<details class="${detailsOpen[1]}">` : "<details>";
  }
  if (line === "</details>") {
    return "</details>";
  }
  const summary = line.match(/^<summary(?:\s+[^>]*)?>([\s\S]*?)<\/summary>$/);
  if (summary && summary[1]) {
    return `<summary>${md.renderInline(summary[1])}</summary>`;
  }
  return null;
}

/**
 * Converts Markdown into HTML. The allowed `<details>` lines split the document: each part between
 * them is rendered on its own, so a details block can wrap lists and tables.
 */
export function markdownToHtml(markdown: string): string {
  const parts: string[] = [];
  let chunk: string[] = [];
  const flush = () => {
    const text = chunk.join("\n");
    if (text.trim()) parts.push(md.render(text).trim());
    chunk = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const tag = toSafeDetailsTag(line.trim());
    if (tag === null) {
      chunk.push(line);
      continue;
    }
    flush();
    parts.push(tag);
  }
  flush();
  return parts.join("\n");
}
