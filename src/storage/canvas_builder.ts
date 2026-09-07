/**
 * [Role] Obsidian JSON Canvas (v1.0) generator.
 * [Mechanism] Generates visual .canvas graph files connecting daily top story,
 * purpose categories, individual articles, and mentioned entities.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PATHS } from "../core/paths";

export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  text?: string | undefined;
  url?: string | undefined;
  file?: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string | undefined; // Obsidian canvas color preset: "1" (red) .. "6" (purple) or hex
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: "top" | "right" | "bottom" | "left";
  toNode: string;
  toSide: "top" | "right" | "bottom" | "left";
  label?: string | undefined;
  color?: string | undefined;
}

export interface JSONCanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasArticle {
  title: string;
  url: string;
  score?: number | undefined;
}

export interface CanvasPurposeGroup {
  key: string;
  label: string;
  articles: CanvasArticle[];
}

export interface DailyCanvasParams {
  date: string;
  topStory: string;
  topStoryUrl?: string | undefined;
  purposeGroups: CanvasPurposeGroup[];
  mentionedCompanies?: string[] | undefined;
  mentionedTechnologies?: string[] | undefined;
  outputDir?: string | undefined;
}

/**
 * Builds a JSON Canvas object following the JSON Canvas spec.
 */
export function buildDailyCanvas(params: DailyCanvasParams): JSONCanvasData {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  const genId = (prefix: string) => `${prefix}_${crypto.randomBytes(4).toString("hex")}`;

  // 1. Root Node (Center) - Top Story & Date
  const rootId = "root_daily";
  nodes.push({
    id: rootId,
    type: "text",
    x: 0,
    y: 0,
    width: 440,
    height: 220,
    color: "1", // Red
    text: `# 📅 ${params.date} デイリートレンド\n\n**🔥 本日の最重要ニュース**\n${params.topStory}${
      params.topStoryUrl ? `\n\n[出典リンク](${params.topStoryUrl})` : ""
    }`,
  });

  // 2. Left Column: Mentioned Entities (Companies & Technologies)
  const entitiesId = "entities_summary";
  const companies = (params.mentionedCompanies ?? []).slice(0, 8);
  const technologies = (params.mentionedTechnologies ?? []).slice(0, 8);

  if (companies.length > 0 || technologies.length > 0) {
    const compText = companies.length > 0
      ? `### 🏢 注目企業\n${companies.map((c) => `- [[Entities/${c}|${c}]]`).join("\n")}\n\n`
      : "";
    const techText = technologies.length > 0
      ? `### ⚙️ 注目技術\n${technologies.map((t) => `- [[Technologies/${t}|${t}]]`).join("\n")}`
      : "";

    nodes.push({
      id: entitiesId,
      type: "text",
      x: -480,
      y: -50,
      width: 380,
      height: 320,
      color: "3", // Yellow
      text: `${compText}${techText}`,
    });

    edges.push({
      id: genId("edge_ent"),
      fromNode: entitiesId,
      fromSide: "right",
      toNode: rootId,
      toSide: "left",
      label: "関連エンティティ",
    });
  }

  // 3. Right Columns: Purpose categories & Articles
  const activePurposes = params.purposeGroups.filter((p) => p.articles.length > 0);
  const categorySpacingY = 260;
  const startY = -((activePurposes.length - 1) * categorySpacingY) / 2;

  activePurposes.forEach((group, pIndex) => {
    const purposeNodeId = `purpose_${group.key}`;
    const purposeY = startY + pIndex * categorySpacingY;

    // Category Node
    nodes.push({
      id: purposeNodeId,
      type: "text",
      x: 540,
      y: purposeY,
      width: 320,
      height: 180,
      color: "4", // Green
      text: `## ${group.label}\n\n収集件数: **${group.articles.length}件**`,
    });

    // Edge Root -> Category
    edges.push({
      id: genId("edge_cat"),
      fromNode: rootId,
      fromSide: "right",
      toNode: purposeNodeId,
      toSide: "left",
    });

    // Articles under this category
    group.articles.slice(0, 3).forEach((article, aIndex) => {
      const articleNodeId = genId(`art_${group.key}`);
      const articleY = purposeY - 60 + aIndex * 100;

      nodes.push({
        id: articleNodeId,
        type: "text",
        x: 940,
        y: articleY,
        width: 380,
        height: 85,
        color: "6", // Purple
        text: `**[${article.title.replace(/[\[\]]/g, "")}](${article.url})**${
          article.score !== undefined ? `\n_Score: ${article.score}_` : ""
        }`,
      });

      edges.push({
        id: genId("edge_art"),
        fromNode: purposeNodeId,
        fromSide: "right",
        toNode: articleNodeId,
        toSide: "left",
      });
    });
  });

  return { nodes, edges };
}

/**
 * Generates and saves the Obsidian Canvas file.
 */
export function saveDailyCanvas(params: DailyCanvasParams): string {
  const canvasData = buildDailyCanvas(params);
  const [yyyy = "unknown", mm = "unknown"] = params.date.split("-");

  const targetDir =
    params.outputDir ??
    path.join(PATHS.ARTIFACTS_DAILY.absolute, yyyy, mm);

  fs.mkdirSync(targetDir, { recursive: true });

  const fileName = `${params.date}_digital-trend_canvas.canvas`;
  const filePath = path.join(targetDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(canvasData, null, 2), "utf8");
  console.log(`🎨 Obsidian Canvas generated: ${filePath}`);

  return filePath;
}
