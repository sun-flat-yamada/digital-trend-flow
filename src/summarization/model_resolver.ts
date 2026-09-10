import { env } from "../core/config";

// Cache the resolved models to avoid repeated API calls
const resolvedCache: Record<string, string> = {};

export function clearResolvedCache(): void {
  for (const key of Object.keys(resolvedCache)) {
    delete resolvedCache[key];
  }
}

export async function resolveModel(configuredModel: string, platform: string = "google"): Promise<string> {
  // If platform is not google, we don't have auto-resolution logic yet.
  // We return the configured model as-is for other platforms (e.g., openai).
  if (platform !== "google") {
    return configuredModel;
  }

  const modelLower = configuredModel.toLowerCase().trim();
  const isAuto =
    modelLower.startsWith("latest-") ||
    modelLower === "cheapest" ||
    modelLower === "cost-effective" ||
    modelLower === "flash-lite";

  // If it's already a specific model like "gemini-2.5-flash", return as is.
  if (!isAuto) {
    return configuredModel;
  }

  const cacheKey = `${platform}:${modelLower}`;
  // Check cache
  if (resolvedCache[cacheKey]) {
    return resolvedCache[cacheKey]!;
  }

  const isFlashLite =
    modelLower.includes("lite") ||
    modelLower === "cheapest" ||
    modelLower === "cost-effective";
  const isPro = !isFlashLite && modelLower.includes("pro");

  // Fallback models as of 2026-09
  const fallbackModel = isFlashLite
    ? "gemini-3.1-flash-lite"
    : isPro
    ? "gemini-2.5-pro"
    : "gemini-3.8-flash";

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models";
    const res = await fetch(url, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    });
    if (!res.ok) {
      throw new Error(`API returned status: ${res.status}`);
    }
    const data = await res.json();
    if (!data.models || !Array.isArray(data.models)) {
      throw new Error("No models array in response");
    }

    // Filter models based on target category: flash-lite / flash / pro
    const geminiModels = data.models
      .filter((m: any) => m.name && m.name.startsWith("models/gemini-"))
      .filter((m: any) => {
        const name = m.name.toLowerCase();
        if (isFlashLite) {
          return name.includes("lite");
        } else if (isPro) {
          return name.includes("pro");
        } else {
          // Base flash: contains flash but NOT lite
          return name.includes("flash") && !name.includes("lite");
        }
      })
      // Favor stable models: exclude -exp (experimental)
      .filter((m: any) => !m.name.toLowerCase().includes("exp"));

    let highestScore = -1;
    let latestModelId = "";

    for (const m of geminiModels) {
      // Extract version: "models/gemini-3.1-flash-lite" -> 3.1, "models/gemini-3-flash" -> 3
      const match = m.name.match(/gemini-(\d+(?:\.\d+)?)/i);
      if (match && match[1]) {
        const version = parseFloat(match[1]);
        const isPreview = m.name.toLowerCase().includes("preview");
        // Prefer stable over preview: stable versions get +0.01 boost
        const score = version + (isPreview ? 0 : 0.01);
        if (score > highestScore) {
          highestScore = score;
          latestModelId = m.name.replace("models/", "");
        } else if (score === highestScore && latestModelId) {
          // Tie-breaker: prefer shorter / standard name
          if (m.name.length < latestModelId.length + 7) {
            latestModelId = m.name.replace("models/", "");
          }
        }
      }
    }

    if (latestModelId) {
      resolvedCache[cacheKey] = latestModelId;
      console.log(`🤖 Auto-resolved ${configuredModel} on ${platform} to -> ${latestModelId}`);
      return latestModelId;
    }

    console.warn(`⚠️ Could not auto-resolve ${configuredModel}, falling back to ${fallbackModel}`);
    resolvedCache[cacheKey] = fallbackModel;
    return fallbackModel;
  } catch (error: any) {
    console.error(`⚠️ Error fetching latest models for ${configuredModel}: ${error.message}`);
    resolvedCache[cacheKey] = fallbackModel;
    return fallbackModel;
  }
}
