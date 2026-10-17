/**
 * [Role] Plugin architecture for extensible source and publisher modules.
 * [Mechanism] A registry that resolves ingestion plugins by source type and runs every registered
 * publishing plugin, plus an event bus for pipeline lifecycle hooks. The built-in sources and
 * publishers are registered in `builtin_plugins.ts`; a new source or publisher is added by
 * registering another plugin, without changing the pipeline.
 *
 * Items: 8.4 Event-driven hooks, 8.5 Plugin Architecture
 */

import type { ArticleItem, Source } from "./types";
import { errorMessage } from "./errors";

// ── Plugin Interfaces ──

export type SourceType = Source["type"];

export interface IngestionPlugin<S extends Source = Source> {
  readonly name: string;
  readonly type: S["type"];
  /** Fetches the new (unprocessed) items of one configured source. Throws on failure. */
  fetch(source: S, purpose: string): Promise<ArticleItem[]>;
  /**
   * Called once the run has published, with the URLs that were summarized. Lets a source act on
   * its items after publication (e.g. Raindrop moves them to the archive collection).
   */
  onPublished?(publishedUrls: string[]): Promise<void>;
}

/**
 * An ingestion plugin for some source type. `fetch` is a method, so a plugin typed for one source
 * type is assignable to it; the registry only ever passes it sources of that type.
 */
export type AnyIngestionPlugin = IngestionPlugin<Source>;

/** The kind of report being published. */
export type ReportKind = "daily" | "weekly" | "monthly" | "yearly";

export interface PublishPayload {
  kind: ReportKind;
  /** Display title, e.g. "Daily Summary 2026-10-17". */
  title: string;
  /** Report body (Markdown, without frontmatter). */
  markdown: string;
  articleCount: number;
  /** Date of the report (YYYY-MM-DD; for periodic reports, the last day of the period). */
  date: string;
  /** Period label: the date for daily, "2026-W42", "2026-09" or "2026" for periodic reports. */
  period: string;
  language: string;
  tags: string[];
}

export interface PublishingPlugin {
  readonly name: string;
  /** Report kinds this publisher handles; all kinds when omitted. */
  readonly kinds?: readonly ReportKind[];
  /** False when the publisher lacks its credentials or is disabled; it is then skipped. */
  isConfigured?(): boolean;
  /** Publishes one report. Throws on failure; the pipeline isolates each publisher's failure. */
  publish(payload: PublishPayload): Promise<void>;
}

// ── Pipeline Event Hooks (Item 8.4) ──

export type PipelineEvent =
  | "ingestion:start"
  | "ingestion:complete"
  | "scoring:complete"
  | "map:complete"
  | "reduce:complete"
  | "quality:complete"
  | "publish:complete"
  | "pipeline:complete"
  | "pipeline:error";

export type EventHandler = (data: Record<string, unknown>) => void | Promise<void>;

export const PIPELINE_EVENTS: readonly PipelineEvent[] = [
  "ingestion:start",
  "ingestion:complete",
  "scoring:complete",
  "map:complete",
  "reduce:complete",
  "quality:complete",
  "publish:complete",
  "pipeline:complete",
  "pipeline:error",
];

class EventBus {
  private handlers: Map<PipelineEvent, EventHandler[]> = new Map();

  /** Registers an event handler. */
  on(event: PipelineEvent, handler: EventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  /** Number of handlers registered for an event. */
  handlerCount(event: PipelineEvent): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  /** Emits an event to all registered handlers. */
  async emit(event: PipelineEvent, data: Record<string, unknown> = {}): Promise<void> {
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      try {
        await handler(data);
      } catch (error) {
        console.warn(`⚠️ Event handler error for ${event}: ${errorMessage(error)}`);
      }
    }
  }
}

// ── Plugin Registry ──

export interface PublishResult {
  name: string;
  status: "published" | "skipped" | "failed";
  error?: string;
}

export class PluginRegistry {
  private ingestionPlugins: Map<string, AnyIngestionPlugin> = new Map();
  private publishingPlugins: Map<string, PublishingPlugin> = new Map();
  readonly events: EventBus = new EventBus();

  /** Registers an ingestion plugin. A later plugin for the same source type replaces the earlier one. */
  registerIngestion<S extends Source>(plugin: IngestionPlugin<S>): void {
    this.ingestionPlugins.set(plugin.type, plugin);
  }

  /** Registers a publishing plugin. */
  registerPublishing(plugin: PublishingPlugin): void {
    this.publishingPlugins.set(plugin.name, plugin);
  }

  /** Gets the ingestion plugin for a source type. */
  getIngestion<T extends SourceType>(type: T): IngestionPlugin<Extract<Source, { type: T }>> | undefined {
    return this.ingestionPlugins.get(type) as IngestionPlugin<Extract<Source, { type: T }>> | undefined;
  }

  /** Gets all registered ingestion plugins. */
  getAllIngestion(): AnyIngestionPlugin[] {
    return Array.from(this.ingestionPlugins.values());
  }

  /** Gets all registered publishing plugins. */
  getAllPublishing(): PublishingPlugin[] {
    return Array.from(this.publishingPlugins.values());
  }

  /** Fetches one configured source through its plugin. Throws when no plugin handles its type. */
  async fetchSource(source: Source, purpose: string): Promise<ArticleItem[]> {
    const plugin = this.getIngestion(source.type);
    if (!plugin) {
      throw new Error(`No ingestion plugin is registered for source type "${source.type}"`);
    }
    return plugin.fetch(source, purpose);
  }

  /** Notifies every ingestion plugin that the run published these URLs. Failures are logged. */
  async notifyPublished(publishedUrls: string[]): Promise<void> {
    for (const plugin of this.ingestionPlugins.values()) {
      if (!plugin.onPublished) continue;
      try {
        await plugin.onPublished(publishedUrls);
      } catch (error) {
        console.warn(`⚠️ Post-publish step of "${plugin.name}" failed: ${errorMessage(error)}`);
      }
    }
  }

  /**
   * Runs every publisher that handles the payload's kind. One publisher's failure never stops the
   * others; each outcome is returned.
   */
  async publishAll(payload: PublishPayload): Promise<PublishResult[]> {
    const publishers = this.getAllPublishing().filter((p) => !p.kinds || p.kinds.includes(payload.kind));
    const settled = await Promise.allSettled(
      publishers.map(async (p) => {
        if (p.isConfigured && !p.isConfigured()) return "skipped" as const;
        await p.publish(payload);
        return "published" as const;
      }),
    );
    return settled.map((result, i) => {
      const name = publishers[i]!.name;
      if (result.status === "fulfilled") return { name, status: result.value };
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`⚠️ Publisher "${name}" failed: ${error}`);
      return { name, status: "failed", error };
    });
  }

  /** Lists all registered plugins. */
  listPlugins(): { ingestion: string[]; publishing: string[] } {
    return {
      ingestion: Array.from(this.ingestionPlugins.keys()),
      publishing: Array.from(this.publishingPlugins.keys()),
    };
  }
}

// Singleton registry
export const registry = new PluginRegistry();
