/** Message of a caught value: the Error's message, or the value itself as a string. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A caught value as an Error, so it can be wrapped (e.g. in an AbortError) without losing it. */
export const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** Fields that HTTP clients (axios) and LLM SDKs put on their errors. All are optional. */
export interface ErrorLike {
  status?: number;
  statusCode?: number;
  message?: string;
  response?: { status?: number; headers?: Record<string, string | undefined> };
}

/** Reads a caught value through the ErrorLike fields; anything that is not an object has none. */
export const asErrorLike = (error: unknown): ErrorLike =>
  typeof error === "object" && error !== null ? (error as ErrorLike) : {};
