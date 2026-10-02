/**
 * [Role] Bounded-concurrency batch execution with rate limiting.
 * [Mechanism] Runs `fn` over items in chunks of `concurrency`, waiting `intervalMs` between
 * chunks, and collects every outcome with Promise.allSettled so one failure never aborts a batch.
 * Kept out of main.ts so it can be imported (and tested) without starting the pipeline.
 */

import { env } from "./config";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = env.API_CONCURRENCY,
  intervalMs: number = env.API_INTERVAL_MS
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    if (i > 0 && intervalMs > 0) {
      await sleep(intervalMs);
    }
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}
