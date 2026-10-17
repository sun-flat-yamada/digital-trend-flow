/**
 * Tests for builtin_plugins.ts: every source type of the config schema has an ingestion plugin,
 * and the publishers follow the publishing settings.
 */

jest.mock("../src/core/config", () => ({
  env: { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" },
  config: {
    purposes: {},
    settings: {
      publishing: {
        notify_kinds: ["daily", "weekly"],
        zenn: { enabled: true, published: false, topics: ["ai"], kinds: ["weekly", "monthly", "yearly"] },
        note: { enabled: false, kinds: ["weekly"] },
        podcast: { enabled: true, voices: {} },
      },
    },
  },
}));

import { SourceSchema } from "../src/core/types";
import { PluginRegistry } from "../src/core/plugin_registry";
import { registerBuiltinPlugins } from "../src/core/builtin_plugins";

describe("registerBuiltinPlugins", () => {
  const reg = registerBuiltinPlugins(new PluginRegistry());

  test("registers an ingestion plugin for every source type of the config schema", () => {
    const sourceTypes = SourceSchema.options.map((o) => o.shape.type.value);
    expect(sourceTypes.length).toBeGreaterThanOrEqual(9);
    for (const type of sourceTypes) {
      expect(reg.getIngestion(type)).toBeDefined();
    }
  });

  test("registers the publishers with the configured report kinds", () => {
    const byName = new Map(reg.getAllPublishing().map((p) => [p.name, p]));
    expect([...byName.keys()].sort()).toEqual(["discord", "email", "note", "slack", "teams", "zenn"]);
    expect(byName.get("discord")?.kinds).toEqual(["daily", "weekly"]);
    expect(byName.get("discord")?.isConfigured?.()).toBe(true);
    expect(byName.get("slack")?.isConfigured?.()).toBe(false);
    expect(byName.get("zenn")?.kinds).toEqual(["weekly", "monthly", "yearly"]);
    expect(byName.get("note")?.isConfigured?.()).toBe(false);
  });

  test("subscribes a handler to every pipeline event", () => {
    expect(reg.events.handlerCount("map:complete")).toBe(1);
    expect(reg.events.handlerCount("pipeline:error")).toBe(1);
  });
});
