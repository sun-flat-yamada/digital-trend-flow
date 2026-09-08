/**
 * Lightweight exponential backoff retry utility compatible with CommonJS & ESM.
 * Implements p-retry semantics with AbortError and onFailedAttempt support.
 */

export class AbortError extends Error {
  readonly originalError: Error;

  constructor(message: string | Error) {
    super(typeof message === "string" ? message : message.message);
    this.name = "AbortError";
    if (message instanceof Error) {
      this.originalError = message;
    } else {
      this.originalError = new Error(message);
    }
  }
}

export interface RetryContext {
  readonly error: any;
  readonly attemptNumber: number;
  readonly retriesLeft: number;
}

export interface RetryOptions {
  retries?: number;
  factor?: number;
  minTimeout?: number;
  maxTimeout?: number;
  onFailedAttempt?: (context: RetryContext) => Promise<void> | void;
}

/**
 * Retries a promise-returning function with exponential backoff.
 */
export async function pRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const factor = options.factor ?? 2;
  const minTimeout = options.minTimeout ?? 2000;
  const maxTimeout = options.maxTimeout ?? 65000;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (error: any) {
      if (error instanceof AbortError) {
        throw error;
      }
      const retriesLeft = retries - attempt + 1;
      if (retriesLeft <= 0) {
        throw error;
      }
      if (options.onFailedAttempt) {
        await options.onFailedAttempt({ error, attemptNumber: attempt, retriesLeft });
      }
      const delay = Math.min(minTimeout * Math.pow(factor, attempt - 1), maxTimeout);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export default pRetry;
