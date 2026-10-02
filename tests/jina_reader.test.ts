/**
 * Tests for content extraction (src/ingestion/jina_reader.ts): only transient failures are
 * retried, a host that keeps failing is skipped, and failures throw with the reason.
 */

import axios from "axios";
import { extractMarkdown, isRetryableStatus, resetExtractionState } from "../src/ingestion/jina_reader";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../src/core/config", () => ({ env: { JINA_API_KEY: "jina-key" } }));
// Retry immediately so the tests do not wait for the backoff.
jest.mock("../src/core/retry", () => {
  const actual = jest.requireActual("../src/core/retry");
  const pRetry = (fn: () => Promise<unknown>, options: object) => actual.pRetry(fn, { ...options, minTimeout: 0 });
  return { ...actual, __esModule: true, pRetry, default: pRetry };
});

const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

describe("extractMarkdown", () => {
  beforeEach(() => {
    resetExtractionState();
    mockedAxios.get.mockReset();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  test("returns the content and sends the API key", async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: "  # Title\n\nBody  " });

    await expect(extractMarkdown("https://example.com/a")).resolves.toBe("# Title\n\nBody");
    expect(mockedAxios.get.mock.calls[0]?.[0]).toBe("https://r.jina.ai/https://example.com/a");
    expect(mockedAxios.get.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer jina-key" });
  });

  test("does not retry a client error", async () => {
    mockedAxios.get.mockRejectedValue(httpError(403));

    await expect(extractMarkdown("https://example.com/a")).rejects.toThrow("Jina returned HTTP 403");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test("retries a server error and succeeds", async () => {
    mockedAxios.get.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce({ status: 200, data: "Body" });

    await expect(extractMarkdown("https://example.com/a")).resolves.toBe("Body");
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  test("treats empty content as a failure", async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: "   " });

    await expect(extractMarkdown("https://example.com/a")).rejects.toThrow("empty content");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test("skips a host after two consecutive failures, without affecting other hosts", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes("blocked.example")) throw httpError(451);
      return { status: 200, data: "Body" };
    });

    await expect(extractMarkdown("https://blocked.example/1")).rejects.toThrow("HTTP 451");
    await expect(extractMarkdown("https://blocked.example/2")).rejects.toThrow("HTTP 451");
    await expect(extractMarkdown("https://blocked.example/3")).rejects.toThrow("2 consecutive extraction failures");
    await expect(extractMarkdown("https://other.example/1")).resolves.toBe("Body");
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });
});

describe("isRetryableStatus", () => {
  test.each([
    [undefined, true],
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [403, false],
    [404, false],
  ])("status %p → %p", (status, expected) => {
    expect(isRetryableStatus(status)).toBe(expected);
  });
});
