/**
 * [Role] Obsidian Vault bidirectional linking and enhanced frontmatter.
 * [Mechanism] Generates backlinks to related notes, enriches frontmatter
 * for DataView queries, and creates MOC (Map of Content) connections.
 *
 * Items: 6.3 Obsidian DataView 強化, 8.3 Obsidian Vault 双方向連携
 */

import { dailySummaryNoteName } from "./markdown_builder";

export interface EnrichedFrontmatter {
  // Standard fields
  tags: string[];
  categories: string[];
  sources: string[];
  // Item 6.3: DataView-optimized fields
  article_count: number;
  top_purpose: string;
  mentioned_companies: string[];
  mentioned_technologies: string[];
  estimated_cost_usd: number;
  execution_time_sec: number;
  quality_score: number;
  // Item 8.3: Linking fields
  top_story: string;
  previous: string;
  next?: string;
  related_notes: string[];
}

// Known entity lists for extraction
const KNOWN_COMPANIES = [
  "OpenAI",
  "Google",
  "Anthropic",
  "Meta",
  "Microsoft",
  "Apple",
  "NVIDIA",
  "Amazon",
  "AWS",
  "Tesla",
  "xAI",
  "Mistral",
  "Cohere",
  "Stability AI",
  "Hugging Face",
  "DeepMind",
  "Inflection",
  "Character.AI",
  "Perplexity",
  "Databricks",
  "Snowflake",
  "Palantir",
  "Scale AI",
  "Anyscale",
  "GitHub",
  "GitLab",
  "Vercel",
  "Cloudflare",
  "Stripe",
];

const KNOWN_TECHNOLOGIES = [
  "transformer",
  "fine-tuning",
  "LLM",
  "GPT",
  "BERT",
  "diffusion",
  "RAG",
  "vector database",
  "embedding",
  "tokenizer",
  "RLHF",
  "DPO",
  "MoE",
  "attention",
  "KV-cache",
  "quantization",
  "distillation",
  "LoRA",
  "QLoRA",
  "PEFT",
  "prompt engineering",
  "chain-of-thought",
  "agentic",
  "multi-agent",
  "function calling",
  "tool use",
  "Kubernetes",
  "Docker",
  "WebAssembly",
  "Rust",
  "TypeScript",
];

/**
 * Extracts mentioned companies from summary text.
 */
export function extractMentionedCompanies(text: string): string[] {
  return KNOWN_COMPANIES.filter((company) => text.toLowerCase().includes(company.toLowerCase()));
}

/**
 * Extracts mentioned technologies from summary text.
 */
export function extractMentionedTechnologies(text: string): string[] {
  return KNOWN_TECHNOLOGIES.filter((tech) => text.toLowerCase().includes(tech.toLowerCase()));
}

/**
 * Builds the enriched frontmatter object for DataView compatibility.
 */
export function buildEnrichedFrontmatter(params: {
  tags: string[];
  categories: string[];
  sources: string[];
  articleCount: number;
  topPurpose: string;
  summaryText: string;
  costUsd: number;
  executionTimeSec: number;
  qualityScore: number;
  topStory: string;
  previousDate: string;
}): EnrichedFrontmatter {
  return {
    tags: params.tags.slice(0, 20),
    categories: params.categories,
    sources: params.sources,
    article_count: params.articleCount,
    top_purpose: params.topPurpose,
    mentioned_companies: extractMentionedCompanies(params.summaryText),
    mentioned_technologies: extractMentionedTechnologies(params.summaryText),
    estimated_cost_usd: Math.round(params.costUsd * 10000) / 10000,
    execution_time_sec: Math.round(params.executionTimeSec),
    quality_score: Math.round(params.qualityScore * 10) / 10,
    top_story: params.topStory,
    previous: dailySummaryNoteName(params.previousDate),
    related_notes: [],
  };
}
