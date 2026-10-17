/**
 * [Role] Registers the built-in sources, publishers and event handlers in the plugin registry.
 * [Mechanism] Each source type of `config.yml` maps to an ingestion plugin, and each delivery
 * channel to a publishing plugin; the pipeline only talks to the registry. Lifecycle events are
 * recorded on the run's Langfuse trace.
 */

import { config, env } from "./config";
import { getActiveTrace, recordEvent } from "./langfuse";
import { PIPELINE_EVENTS, PluginRegistry, registry as defaultRegistry } from "./plugin_registry";
import type { AnyIngestionPlugin, IngestionPlugin, PublishingPlugin } from "./plugin_registry";
import type { Source } from "./types";
import { archiveProcessedRaindrops, archivableRaindropIds } from "../ingestion/raindrop";
import { fetchSource, type RaindropResultSet } from "../ingestion/fetch_source";
import { notifyDiscord } from "../publishing/discord_notifier";
import { notifySlack } from "../publishing/slack_notifier";
import { notifyTeams } from "../publishing/teams_notifier";
import { notifyEmail } from "../publishing/email_notifier";
import { publishZennArticle, publishNoteDraft } from "../publishing/note_api";

type SourceOf<T extends Source["type"]> = Extract<Source, { type: T }>;

/** Raindrop source: remembers what it fetched so that summarized bookmarks can be archived. */
export function createRaindropPlugin(): IngestionPlugin<SourceOf<"raindrop">> {
  const fetched: RaindropResultSet[] = [];
  return {
    name: "Raindrop.io",
    type: "raindrop",
    fetch: (s, purpose) => fetchSource({ ...s, purpose }, (result) => fetched.push(result)),
    async onPublished(publishedUrls) {
      for (const rs of fetched) {
        const archiveIds = archivableRaindropIds(rs, publishedUrls);
        if (archiveIds.length > 0) {
          await archiveProcessedRaindrops(rs.collectionId, archiveIds, rs.archiveId);
        }
      }
    },
  };
}

/** A source type fetched through the shared adapter routing (`ingestion/fetch_source.ts`). */
function sourcePlugin(name: string, type: Source["type"]): AnyIngestionPlugin {
  return { name, type, fetch: (s, purpose) => fetchSource({ ...s, purpose }) };
}

export function builtinIngestionPlugins(): AnyIngestionPlugin[] {
  return [
    sourcePlugin("RSS", "rss"),
    createRaindropPlugin(),
    sourcePlugin("X (xAI Grok)", "xai_grok"),
    sourcePlugin("Hacker News", "hackernews"),
    sourcePlugin("arXiv", "arxiv"),
    sourcePlugin("YouTube", "youtube"),
    sourcePlugin("GitHub Trending", "github_trending"),
    sourcePlugin("Reddit", "reddit"),
    sourcePlugin("Bluesky", "bluesky"),
  ];
}

export function builtinPublishingPlugins(): PublishingPlugin[] {
  const publishing = config.settings.publishing;
  const notifyKinds = publishing.notify_kinds;
  return [
    {
      name: "discord",
      kinds: notifyKinds,
      isConfigured: () => Boolean(env.DISCORD_WEBHOOK_URL),
      publish: (p) => notifyDiscord(p.title, p.markdown, p.articleCount),
    },
    {
      name: "slack",
      kinds: notifyKinds,
      isConfigured: () => Boolean(env.SLACK_WEBHOOK_URL),
      publish: (p) => notifySlack(p.title, p.markdown, p.articleCount),
    },
    {
      name: "teams",
      kinds: notifyKinds,
      isConfigured: () => Boolean(env.TEAMS_WEBHOOK_URL),
      publish: (p) => notifyTeams(p.title, p.markdown, p.articleCount),
    },
    {
      name: "email",
      kinds: notifyKinds,
      isConfigured: () => Boolean(env.SMTP_HOST && env.MAIL_TO),
      publish: (p) => notifyEmail(p.title, p.markdown, p.articleCount),
    },
    {
      name: "zenn",
      kinds: publishing.zenn.kinds,
      isConfigured: () => publishing.zenn.enabled,
      publish: async (p) => {
        publishZennArticle(p, { published: publishing.zenn.published, topics: publishing.zenn.topics });
      },
    },
    {
      name: "note",
      kinds: publishing.note.kinds,
      isConfigured: () => publishing.note.enabled,
      publish: async (p) => {
        await publishNoteDraft(p, env.NOTE_API_TOKEN);
      },
    },
  ];
}

let registered = false;

/** Registers the built-in plugins and event handlers once. Returns the registry. */
export function registerBuiltinPlugins(target: PluginRegistry = defaultRegistry): PluginRegistry {
  if (target === defaultRegistry && registered) return target;
  for (const plugin of builtinIngestionPlugins()) target.registerIngestion(plugin);
  for (const plugin of builtinPublishingPlugins()) target.registerPublishing(plugin);
  // Stage boundaries become events on the run's Langfuse trace (no-op when tracing is off).
  for (const event of PIPELINE_EVENTS) {
    target.events.on(event, (data) => recordEvent(getActiveTrace(), event, data));
  }
  if (target === defaultRegistry) registered = true;
  return target;
}
