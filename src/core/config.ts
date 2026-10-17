import * as fs from "fs";
import * as path from "path";
import { PATHS } from "./paths";
import * as yaml from "yaml";
import * as dotenv from "dotenv";
import { z } from "zod";
import { AppConfig, ConfigSchema, EnvConfig, EnvSchema } from "./types";
import { errorMessage } from "./errors";

/**
 * Ensures environment variables are loaded from .env file (if present)
 * and validates them against the EnvSchema.
 * This function should crash early if critical secrets are missing.
 */
function loadAndValidateEnv(): EnvConfig {
  // Load .env file silently. In GitHub Actions, secrets are passed directly
  // via the environment, so failure to find .env is fine.
  dotenv.config({ quiet: true });

  try {
    return EnvSchema.parse(process.env);
  } catch (error) {
    console.error("❌ Critical Error: Environment variables validation failed.");
    console.error(error instanceof z.ZodError ? z.prettifyError(error) : errorMessage(error));
    process.exit(1);
  }
}

/**
 * Loads, parses, and validates the config.yml file against the ConfigSchema.
 */
function loadAndValidateConfig(configPath: string): AppConfig {
  try {
    const absolutePath = path.resolve(configPath);
    const fileContents = fs.readFileSync(absolutePath, "utf8");
    const parsedYaml = yaml.parse(fileContents);

    return ConfigSchema.parse(parsedYaml);
  } catch (error) {
    console.error(`❌ Critical Error: Failed to load or validate config at ${configPath}`);
    // A Zod validation error lists every invalid field; anything else is a file read or YAML parse error.
    console.error(error instanceof z.ZodError ? z.prettifyError(error) : errorMessage(error));
    process.exit(1);
  }
}

/**
 * Applies environment variable overrides to configuration.
 */
function applyEnvOverrides(cfg: AppConfig, envCfg: EnvConfig): AppConfig {
  const mapOverride = envCfg.AI_MODEL_MAP || envCfg.GEMINI_MAP_MODEL;
  const reduceOverride = envCfg.AI_MODEL_REDUCE || envCfg.GEMINI_REDUCE_MODEL;
  const platformOverride = envCfg.AI_MODEL_PLATFORM;

  if (mapOverride || reduceOverride || platformOverride) {
    return {
      ...cfg,
      settings: {
        ...cfg.settings,
        models: {
          ...cfg.settings.models,
          ...(platformOverride ? { platform: platformOverride } : {}),
          ...(mapOverride ? { map: mapOverride } : {}),
          ...(reduceOverride ? { reduce: reduceOverride } : {}),
        },
      },
    };
  }
  return cfg;
}

// Singleton instances loaded synchronously at startup.
// It is explicitly intentional to load this once at application boot to 'fail fast'.
export const env = loadAndValidateEnv();
export const config = applyEnvOverrides(loadAndValidateConfig(PATHS.CONFIG), env);

export default {
  env,
  config,
};
