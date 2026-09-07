/**
 * [Role] Reduce phase of the Map-Reduce summarization pipeline.
 * [Mechanism] Uses the LLM Gateway to synthesize extracted facts into
 * a purpose-sectioned Markdown summary with cost tracking.
 *
 * Items: 1.1 Structured Output, 1.2 Multi-LLM Fallback
 */

import { llmCall } from "./llm_gateway";
import { buildReducePrompt } from "./prompts";
import { MapOutput } from "./gemini_map";

// Token management: conservative character limit for reduce input.
const MAX_REDUCE_INPUT_CHARS = 200_000;

/**
 * Reduce phase: Synthesize all extracted facts into a purpose-sectioned
 * Markdown summary using the high-performance model via LLM Gateway.
 */
export async function reduceSummarize(
  allFacts: (MapOutput & { purpose: string; purposeLabel: string; score?: number })[],
  date: string,
  activePurposes: { key: string; label: string }[] = []
): Promise<string> {
  try {
    // Build dynamic purpose-aware prompt
    const systemPrompt = buildReducePrompt(activePurposes);

    // Compress facts: strip internal metadata, keep only what the LLM needs
    const compressedFacts = allFacts.map((f) => ({
      title: f.source_title,
      url: f.source_url,
      facts: f.facts,
      category: f.purposeLabel,
      ...(f.score !== undefined ? { pipeline_score: f.score } : {}),
    }));

    // Identify highest-scored article to guide LLM's "top news" selection
    let topScoredTitle = "";
    let topScore = -1;
    for (const f of allFacts) {
      if ((f.score ?? 0) > topScore) {
        topScore = f.score ?? 0;
        topScoredTitle = f.source_title;
      }
    }

    // Token management: if input exceeds safe limit, prune low-importance facts
    let finalFacts = compressedFacts;
    let factsPayload = JSON.stringify(finalFacts);

    if (factsPayload.length > MAX_REDUCE_INPUT_CHARS) {
      console.warn(
        `⚠️ Reduce input exceeds safe limit (${factsPayload.length} chars). Filtering low-importance facts.`
      );
      finalFacts = compressedFacts
        .map((f) => ({
          ...f,
          facts: f.facts.filter((fact) => fact.importance >= 5),
        }))
        .filter((f) => f.facts.length > 0);
      factsPayload = JSON.stringify(finalFacts);
      console.log(`  → Pruned to ${factsPayload.length} chars.`);
    }

    const userPrompt = `Today's date: ${date}

Active purpose categories: ${activePurposes.map((p) => p.label).join(", ")}

Highest-scored article by pipeline: "${topScoredTitle}" (score: ${topScore})

Here are the extracted facts from ${finalFacts.length} articles:

${factsPayload}

Based on these facts, generate the daily briefing with purpose-sectioned format.`;

    const response = await llmCall({
      systemPrompt,
      userPrompt,
      phase: "reduce",
      maxOutputTokens: 8192,
    });

    return response.text;
  } catch (error: any) {
    console.error(`❌ Reduce summarization failed: ${error.message}`);
    // Fallback: generate a purpose-grouped raw fact dump
    const grouped = new Map<string, typeof allFacts>();
    for (const f of allFacts) {
      const existing = grouped.get(f.purposeLabel) ?? [];
      existing.push(f);
      grouped.set(f.purposeLabel, existing);
    }

    const sections = Array.from(grouped.entries())
      .map(
        ([label, facts]) =>
          `## ${label}\n\n${facts
            .map(
              (f) =>
                `### ${f.source_title}\n**出典**: ${f.source_url}\n${f.facts.map((fact) => `- ${fact.text}`).join("\n")}`
            )
            .join("\n\n")}`
      )
      .join("\n\n---\n\n");

    return `# Daily Summary (${date}) - Fallback Mode\n\n> ⚠️ LLM summarization failed. Raw facts are listed below.\n\n${sections}`;
  }
}
