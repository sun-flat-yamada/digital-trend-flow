/**
 * Tests for plugin_registry.ts — event bus and plugin registration.
 */

import { registry } from "../src/core/plugin_registry";
import type { IngestionPlugin, PublishingPlugin } from "../src/core/plugin_registry";

describe("PluginRegistry", () => {
  test("registers and retrieves ingestion plugin", () => {
    const mockPlugin: IngestionPlugin = {
      name: "Test Source",
      type: "test_source",
      fetch: async () => [],
    };

    registry.registerIngestion(mockPlugin);
    const retrieved = registry.getIngestion("test_source");
    expect(retrieved).toBe(mockPlugin);
  });

  test("registers and lists publishing plugins", () => {
    const mockPublisher: PublishingPlugin = {
      name: "Test Publisher",
      publish: async () => {},
    };

    registry.registerPublishing(mockPublisher);
    const all = registry.getAllPublishing();
    expect(all.some((p) => p.name === "Test Publisher")).toBe(true);
  });

  test("lists all registered plugins", () => {
    const list = registry.listPlugins();
    expect(list.ingestion).toContain("test_source");
    expect(list.publishing).toContain("Test Publisher");
  });

  test("returns undefined for unregistered types", () => {
    const result = registry.getIngestion("nonexistent_type");
    expect(result).toBeUndefined();
  });
});

describe("EventBus", () => {
  test("emits and handles events", async () => {
    let called = false;
    let receivedData: Record<string, unknown> = {};

    registry.events.on("ingestion:start", (data) => {
      called = true;
      receivedData = data;
    });

    await registry.events.emit("ingestion:start", { date: "2026-04-18" });
    expect(called).toBe(true);
    expect(receivedData["date"]).toBe("2026-04-18");
  });

  test("handles errors in event handlers without throwing", async () => {
    registry.events.on("pipeline:error", () => {
      throw new Error("Handler error");
    });

    // Should not throw
    await expect(
      registry.events.emit("pipeline:error", { error: "test" })
    ).resolves.not.toThrow();
  });

  test("supports multiple handlers for same event", async () => {
    let count = 0;
    registry.events.on("pipeline:complete", () => { count++; });
    registry.events.on("pipeline:complete", () => { count++; });

    await registry.events.emit("pipeline:complete");
    expect(count).toBe(2);
  });
});
