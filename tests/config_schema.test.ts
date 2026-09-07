/**
 * Tests for config schema validation — ensures config.yml matches types.ts schema.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { ConfigSchema, EnvSchema } from "../src/core/types";

describe("Config Schema Validation", () => {
  test("config.yml parses successfully against ConfigSchema", () => {
    const configPath = path.join(process.cwd(), "config.yml");
    expect(fs.existsSync(configPath)).toBe(true);

    const raw = yaml.parse(fs.readFileSync(configPath, "utf8"));
    const result = ConfigSchema.safeParse(raw);

    if (!result.success) {
      // Format errors for debug output
      const errors = result.error.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      }));
      console.error("Config validation errors:", JSON.stringify(errors, null, 2));
    }

    expect(result.success).toBe(true);
  });

  test("config.yml has required version field", () => {
    const raw = yaml.parse(fs.readFileSync(path.join(process.cwd(), "config.yml"), "utf8"));
    expect(raw.version).toBeDefined();
    expect(typeof raw.version).toBe("string");
  });

  test("all purposes have valid scoring or null (curated)", () => {
    const raw = yaml.parse(fs.readFileSync(path.join(process.cwd(), "config.yml"), "utf8"));
    const config = ConfigSchema.parse(raw);

    for (const [key, purpose] of Object.entries(config.purposes)) {
      if (purpose.scoring === null) {
        // Curated — scoring is null, which is valid
        expect(purpose.scoring).toBeNull();
      } else {
        // Non-curated — must have threshold and keywords
        expect(purpose.scoring.threshold).toBeDefined();
        expect(purpose.scoring.keywords.length).toBeGreaterThan(0);
      }
    }
  });

  test("all source types are recognized in discriminated union", () => {
    const raw = yaml.parse(fs.readFileSync(path.join(process.cwd(), "config.yml"), "utf8"));
    const config = ConfigSchema.parse(raw);

    const validTypes = ["rss", "xai_grok", "raindrop", "hackernews", "arxiv", "youtube", "github_trending", "reddit", "bluesky"];
    for (const [purposeKey, purpose] of Object.entries(config.purposes)) {
      for (const source of purpose.sources) {
        expect(validTypes).toContain(source.type);
      }
    }
  });

  test("exclude blocklist has valid structure", () => {
    const raw = yaml.parse(fs.readFileSync(path.join(process.cwd(), "config.yml"), "utf8"));
    const config = ConfigSchema.parse(raw);

    expect(config.exclude.domains.length).toBeGreaterThan(0);
    expect(config.exclude.content_length.min).toBeLessThan(config.exclude.content_length.max);
  });

  test("EnvSchema allows optional keys", () => {
    // Simulate minimal env (only GEMINI_API_KEY required)
    const result = EnvSchema.safeParse({
      GEMINI_API_KEY: "test-key-12345",
    });
    expect(result.success).toBe(true);
  });

  test("EnvSchema rejects missing GEMINI_API_KEY", () => {
    const result = EnvSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("settings have new v2.0 fields", () => {
    const raw = yaml.parse(fs.readFileSync(path.join(process.cwd(), "config.yml"), "utf8"));
    const config = ConfigSchema.parse(raw);

    // Freshness
    expect(config.settings.freshness).toBeDefined();
    expect(config.settings.freshness.enabled).toBeDefined();
    expect(typeof config.settings.freshness.decay_lambda).toBe("number");

    // LLM Judge
    expect(config.settings.llm_judge).toBeDefined();
    expect(typeof config.settings.llm_judge.enabled).toBe("boolean");

    // Semantic dedup
    expect(config.settings.semantic_dedup).toBeDefined();
    expect(typeof config.settings.semantic_dedup.similarity_threshold).toBe("number");

    // State TTL
    expect(config.settings.state_ttl_days).toBeDefined();
    expect(config.settings.state_ttl_days).toBeGreaterThan(0);
  });
});
