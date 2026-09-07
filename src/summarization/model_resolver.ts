import { env } from "../core/config";

// Cache the resolved models to avoid repeated API calls
const resolvedCache: Record<string, string> = {};

export async function resolveModel(configuredModel: string, platform: string = "google"): Promise<string> {
  // If platform is not google, we don't have auto-resolution logic yet.
  // We return the configured model as-is for other platforms (e.g., openai).
  if (platform !== "google") {
    return configuredModel;
  }

  // If it's already a specific model like "gemini-2.0-flash", return as is.
  if (!configuredModel.startsWith("latest-")) {
    return configuredModel;
  }

  const cacheKey = `${platform}:${configuredModel}`;
  // Check cache
  if (resolvedCache[cacheKey]) {
    return resolvedCache[cacheKey];
  }

  const isFlash = configuredModel.includes("flash");
  const fallbackModel = isFlash ? "gemini-2.0-flash" : "gemini-2.0-pro";

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

    // Filter models based on flash / pro
    const targetType = isFlash ? "flash" : "pro";
    
    // Example model name: "models/gemini-2.0-flash", "models/gemini-1.5-pro"
    // We want the one with the highest version number.
    // Avoid "-exp" or "-thinking" or "-8b" variants if possible by checking for exact ending,
    // though new models might have different suffixes. We prioritize the base flash/pro.
    let highestVersion = -1;
    let latestModelId = "";

    const geminiModels = data.models
      .filter((m: any) => m.name.startsWith("models/gemini-"))
      .filter((m: any) => m.name.includes(targetType))
      // Favor stable models over experimental ones by filtering out "-exp" for the automatic selection
      .filter((m: any) => !m.name.includes("exp"));

    for (const m of geminiModels) {
      // Extract version: "models/gemini-2.0-flash" -> 2.0
      const match = m.name.match(/gemini-(\d+\.\d+)/);
      if (match) {
        const version = parseFloat(match[1]);
        if (version > highestVersion) {
          highestVersion = version;
          latestModelId = m.name.replace("models/", ""); 
        } else if (version === highestVersion) {
          // If tie (e.g., gemini-2.0-flash and gemini-2.0-flash-lite), pick the shorter one to get the base model
          if (latestModelId && m.name.length < latestModelId.length + 7) { 
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
    return fallbackModel;
    
  } catch (error: any) {
    console.error(`⚠️ Error fetching latest models for ${configuredModel}: ${error.message}`);
    return fallbackModel;
  }
}
