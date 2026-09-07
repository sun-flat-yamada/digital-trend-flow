import * as fs from "fs";
import * as path from "path";
import { PATHS } from "./paths";
import * as yaml from "yaml";
import * as dotenv from "dotenv";
import { AppConfig, ConfigSchema, EnvConfig, EnvSchema } from "./types";

/**
 * Ensures environment variables are loaded from .env file (if present)
 * and validates them against the EnvSchema.
 * This function should crash early if critical secrets are missing.
 */
function loadAndValidateEnv(): EnvConfig {
  // Load .env file silently. In GitHub Actions, secrets are passed directly
  // via the environment, so failure to find .env is fine.
  dotenv.config();

  try {
    return EnvSchema.parse(process.env);
  } catch (error: any) {
    console.error("❌ Critical Error: Environment variables validation failed.");
    console.error(error.errors || error.message);
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
  } catch (error: any) {
    console.error(`❌ Critical Error: Failed to load or validate config at ${configPath}`);
    if (error.errors) {
      // Zod validation error
      console.error(JSON.stringify(error.errors, null, 2));
    } else {
      // File read or YAML parse error
      console.error(error.message);
    }
    process.exit(1);
  }
}

// Singleton instances loaded synchronously at startup.
// It is explicitly intentional to load this once at application boot to 'fail fast'.
export const env = loadAndValidateEnv();
export const config = loadAndValidateConfig(PATHS.CONFIG);

export default {
  env,
  config
};
