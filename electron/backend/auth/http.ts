import { Effect } from "effect";
import { ProviderError } from "../errors";
import { getValidAccessToken } from "./provider-auth";
import type { AuthTokenStore } from "./token-store";

type ApiRequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  accept?: string;
};

const API_REQUEST_TIMEOUT_MS = 30_000;

function toProviderError(error: unknown) {
  return error instanceof ProviderError
    ? error
    : new ProviderError(error instanceof Error ? error.message : String(error));
}

function readResponseBody(response: Response): Effect.Effect<string, ProviderError> {
  return Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: toProviderError,
    });
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof parsed.message === "string"
      ) {
        return parsed.message;
      }
    } catch {
      // Keep the raw text below.
    }
    return text;
  });
}

function providerFetch(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
): Effect.Effect<Response, ProviderError, AuthTokenStore> {
  return Effect.gen(function* () {
    const token = yield* getValidAccessToken(accountId).pipe(
      Effect.mapError(toProviderError),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    const response = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
              Accept: options.accept ?? "application/json",
              Authorization: `Bearer ${token}`,
              "User-Agent": "rudu",
              ...options.headers,
            },
          });
        } finally {
          clearTimeout(timeout);
        }
      },
      catch: (error) => {
        if (controller.signal.aborted) {
          return new ProviderError(
            `Provider API request timed out after ${API_REQUEST_TIMEOUT_MS / 1000}s: ${url}`,
          );
        }
        return toProviderError(error);
      },
    });

    if (!response.ok) {
      const message = yield* readResponseBody(response);
      return yield* Effect.fail(
        new ProviderError(message || `Provider API returned HTTP ${response.status}`),
      );
    }
    return response;
  });
}

function providerJson<T>(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
): Effect.Effect<T, ProviderError, AuthTokenStore> {
  return Effect.gen(function* () {
    const response = yield* providerFetch(accountId, url, options);
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<T>,
      catch: toProviderError,
    });
  });
}

function providerText(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
): Effect.Effect<string, ProviderError, AuthTokenStore> {
  return Effect.gen(function* () {
    const response = yield* providerFetch(accountId, url, options);
    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: toProviderError,
    });
  });
}

export { providerFetch, providerJson, providerText };
