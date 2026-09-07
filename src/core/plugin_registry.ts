/**
 * [Role] Plugin architecture for extensible source and publisher modules.
 * [Mechanism] Defines interfaces and a registry for dynamically loading
 * ingestion and publishing plugins from configuration.
 *
 * Items: 8.4 Event-driven hooks, 8.5 Plugin Architecture
 */

import { ArticleItem } from "../ingestion/rss";

// ── Plugin Interfaces ──

export interface IngestionPlugin {
  readonly name: string;
  readonly type: string;
  fetch(config: Record<string, unknown>, purpose: string): Promise<ArticleItem[]>;
}

export interface PublishingPlugin {
  readonly name: string;
  publish(title: string, content: string, articleCount: number): Promise<void>;
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

class EventBus {
  private handlers: Map<PipelineEvent, EventHandler[]> = new Map();

  /** Registers an event handler. */
  on(event: PipelineEvent, handler: EventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  /** Emits an event to all registered handlers. */
  async emit(event: PipelineEvent, data: Record<string, unknown> = {}): Promise<void> {
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      try {
        await handler(data);
      } catch (error: any) {
        console.warn(`⚠️ Event handler error for ${event}: ${error.message}`);
      }
    }
  }
}

// ── Plugin Registry ──

class PluginRegistry {
  private ingestionPlugins: Map<string, IngestionPlugin> = new Map();
  private publishingPlugins: Map<string, PublishingPlugin> = new Map();
  readonly events: EventBus = new EventBus();

  /** Registers an ingestion plugin. */
  registerIngestion(plugin: IngestionPlugin): void {
    this.ingestionPlugins.set(plugin.type, plugin);
    console.log(`🔌 Registered ingestion plugin: ${plugin.name} (${plugin.type})`);
  }

  /** Registers a publishing plugin. */
  registerPublishing(plugin: PublishingPlugin): void {
    this.publishingPlugins.set(plugin.name, plugin);
    console.log(`🔌 Registered publishing plugin: ${plugin.name}`);
  }

  /** Gets an ingestion plugin by source type. */
  getIngestion(type: string): IngestionPlugin | undefined {
    return this.ingestionPlugins.get(type);
  }

  /** Gets all registered publishing plugins. */
  getAllPublishing(): PublishingPlugin[] {
    return Array.from(this.publishingPlugins.values());
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
