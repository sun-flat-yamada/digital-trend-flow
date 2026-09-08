/**
 * Unit tests for mapWithConcurrency rate limiting and concurrency execution.
 */

import { mapWithConcurrency } from "../src/main";

describe("mapWithConcurrency", () => {
  test("processes items respecting concurrency limits", async () => {
    let currentlyRunning = 0;
    let maxRunning = 0;

    const items = [1, 2, 3, 4, 5, 6];
    const worker = async (item: number) => {
      currentlyRunning++;
      maxRunning = Math.max(maxRunning, currentlyRunning);
      await new Promise((resolve) => setTimeout(resolve, 50));
      currentlyRunning--;
      return item * 10;
    };

    const results = await mapWithConcurrency(items, worker, 2, 0);

    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const values = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    expect(values).toEqual([10, 20, 30, 40, 50, 60]);
  });

  test("introduces interval delay between chunks", async () => {
    const items = [1, 2, 3];
    const start = Date.now();

    const worker = async (item: number) => {
      return item;
    };

    // Concurrency 1, interval 60ms => Chunk 1 (0ms), Chunk 2 (60ms), Chunk 3 (60ms) => ~120ms total delay
    const results = await mapWithConcurrency(items, worker, 1, 60);
    const duration = Date.now() - start;

    expect(results).toHaveLength(3);
    expect(duration).toBeGreaterThanOrEqual(100);
  });

  test("handles empty items gracefully without delay", async () => {
    const start = Date.now();
    const results = await mapWithConcurrency([], async () => 1, 1, 1000);
    const duration = Date.now() - start;

    expect(results).toEqual([]);
    expect(duration).toBeLessThan(100);
  });

  test("settles all promises even if some workers fail", async () => {
    const items = ["ok1", "fail", "ok2"];
    const worker = async (item: string) => {
      if (item === "fail") {
        throw new Error("Worker failure");
      }
      return item.toUpperCase();
    };

    const results = await mapWithConcurrency(items, worker, 2, 10);
    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]?.status).toBe("fulfilled");
  });
});
