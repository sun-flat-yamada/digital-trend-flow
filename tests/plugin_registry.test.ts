/**
 * Tests for plugin_registry.ts — plugin resolution, publishing and the event bus.
 */

import { PluginRegistry, registry } from "../src/core/plugin_registry";
import type { IngestionPlugin, PublishingPlugin, PublishPayload } from "../src/core/plugin_registry";
import type { Source } from "../src/core/types";

const payload = (kind: PublishPayload["kind"]): PublishPayload => ({
  kind,
  title: "Report",
  markdown: "## Body",
  articleCount: 3,
  date: "2026-10-17",
  period: "2026-10-17",
  language: "en",
  tags: [],
});

const rssSource: Source = { type: "rss", name: "Feed", enabled: true, url: "https://example.com/feed" };

describe("PluginRegistry", () => {
  test("resolves a source through the plugin registered for its type", async () => {
    const reg = new PluginRegistry();
    const fetch = jest.fn(async () => [
      {
        title: "A",
        url: "https://example.com/a",
        sourceName: "Feed",
        sourceType: "rss",
        purpose: "p",
        publishedAt: "2026-10-17T00:00:00Z",
      },
    ]);
    const plugin: IngestionPlugin<Extract<Source, { type: "rss" }>> = { name: "RSS", type: "rss", fetch };
    reg.registerIngestion(plugin);

    const items = await reg.fetchSource(rssSource, "ai_research");

    expect(reg.getIngestion("rss")).toBe(plugin);
    expect(fetch).toHaveBeenCalledWith(rssSource, "ai_research");
    expect(items).toHaveLength(1);
  });

  test("fetchSource rejects for a source type without a plugin", async () => {
    await expect(new PluginRegistry().fetchSource(rssSource, "p")).rejects.toThrow(
      'No ingestion plugin is registered for source type "rss"',
    );
  });

  test("publishAll filters by kind, skips unconfigured publishers and isolates failures", async () => {
    const reg = new PluginRegistry();
    const published: string[] = [];
    const make = (name: string, extra: Partial<PublishingPlugin> = {}): PublishingPlugin => ({
      name,
      publish: async () => {
        published.push(name);
      },
      ...extra,
    });
    reg.registerPublishing(make("all"));
    reg.registerPublishing(make("periodic", { kinds: ["weekly", "monthly"] }));
    reg.registerPublishing(make("unconfigured", { isConfigured: () => false }));
    reg.registerPublishing(
      make("broken", {
        publish: async () => {
          throw new Error("boom");
        },
      }),
    );
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const results = await reg.publishAll(payload("daily"));

    expect(published).toEqual(["all"]);
    expect(results).toEqual([
      { name: "all", status: "published" },
      { name: "unconfigured", status: "skipped" },
      { name: "broken", status: "failed", error: "boom" },
    ]);
    expect((await reg.publishAll(payload("weekly"))).map((r) => r.name)).toContain("periodic");
  });

  test("notifyPublished calls onPublished of every source and survives failures", async () => {
    const reg = new PluginRegistry();
    const seen: string[][] = [];
    reg.registerIngestion({
      name: "A",
      type: "rss",
      fetch: async () => [],
      onPublished: async (urls) => {
        seen.push(urls);
      },
    });
    reg.registerIngestion({
      name: "B",
      type: "arxiv",
      fetch: async () => [],
      onPublished: async () => {
        throw new Error("fail");
      },
    });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(reg.notifyPublished(["https://example.com/a"])).resolves.toBeUndefined();
    expect(seen).toEqual([["https://example.com/a"]]);
  });

  test("lists all registered plugins", () => {
    const reg = new PluginRegistry();
    reg.registerIngestion({ name: "RSS", type: "rss", fetch: async () => [] });
    reg.registerPublishing({ name: "Test Publisher", publish: async () => {} });
    expect(reg.listPlugins()).toEqual({ ingestion: ["rss"], publishing: ["Test Publisher"] });
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
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    registry.events.on("pipeline:error", () => {
      throw new Error("Handler error");
    });

    // Should not throw
    await expect(registry.events.emit("pipeline:error", { error: "test" })).resolves.not.toThrow();
  });

  test("supports multiple handlers for same event", async () => {
    let count = 0;
    registry.events.on("pipeline:complete", () => {
      count++;
    });
    registry.events.on("pipeline:complete", () => {
      count++;
    });

    await registry.events.emit("pipeline:complete");
    expect(count).toBe(2);
  });
});
